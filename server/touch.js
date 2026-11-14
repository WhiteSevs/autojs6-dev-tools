import { spawn } from 'node:child_process'

const ADB_BIN = process.env.ADB_PATH || 'adb'

/** 抬手后这么久没有新事件就自动松开并收掉 shell，避免前端崩了留下「一直按着」 */
const IDLE_RELEASE_MS = 3000
/**
 * 按住不动时的兜底：前端崩了也不会让手指永远按在屏幕上。
 * 长按本身不该被空闲逻辑判成手势结束，所以这里给一个明显更长的窗口。
 */
const PRESS_GUARD_MS = 8000
/**
 * 通道「异常」退出（adb server 重启 / USB 抖动 / 设备休眠）后的短暂退避，
 * 避免 adb 已经挂了还被事件风暴反复 spawn。
 * 注意：正常空闲回收不设冷却 —— 那是设计内的关闭，下一笔手势必须立刻可用。
 */
const FAIL_COOLDOWN_MS = 400
/**
 * 设备上允许排队的指令条数。
 * 实测：持久 shell 里一条 `input motionevent` 从写入到 ack 回来约 98ms（其中设备执行约 35ms，
 * 其余是 adb 管道的往返），所以放 3 条在途既能跟手，又不会因为慢就疯狂堆积。
 * 超出后前端发来的中间点会被直接丢掉，只保留最新位置。
 */
const MAX_IN_FLIGHT = 3

/** serial -> session */
const sessions = new Map()
/** serial -> 冷却截止时间：只在通道异常退出后使用 */
const cooldowns = new Map()

function createSession(serial) {
  const child = spawn(ADB_BIN, ['-s', serial, 'shell'], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
  })
  const session = {
    serial,
    child,
    dead: false,
    /** 我们自己主动收掉的（空闲回收 / 抬手收尾），close 回调据此判断要不要退避 */
    planned: false,
    pressing: false,
    x: 0,
    y: 0,
    inFlight: 0,
    pending: null,
    idleTimer: null,
    error: '',
  }

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (text) => {
    // 每条指令后面都跟一个 echo，用它的输出数「设备上还有几条没跑完」
    const acks = text.split('\n').length - 1
    if (!acks) return
    session.inFlight = Math.max(0, session.inFlight - acks)
    flushMove(session)
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (t) => {
    session.error = (session.error + t).slice(-300)
  })
  child.on('error', (err) => {
    session.dead = true
    session.error = err.message
    // spawn 失败（adb 不在 PATH / 权限不足）不一定等得到 close，
    // 这里先把会话摘掉，否则这个死会话会一直挡住后面的重建
    if (sessions.get(serial) === session) sessions.delete(serial)
    cooldowns.set(serial, Date.now() + FAIL_COOLDOWN_MS)
  })
  child.on('close', () => {
    session.dead = true
    // 只有非主动的退出才算故障；主动回收后下一笔手势应该能立刻建通道
    if (!session.planned) cooldowns.set(serial, Date.now() + FAIL_COOLDOWN_MS)
    if (sessions.get(serial) === session) sessions.delete(serial)
  })
  // adb 没了也要让 write 失败得干净，而不是抛未捕获异常
  child.stdin.on('error', () => {
    session.dead = true
  })

  sessions.set(serial, session)
  return session
}

/**
 * 取一条可用的通道。
 * 已经死掉的会话必须先摘掉，否则后面每个事件都会撞上「adb shell 已退出」而永远不重建。
 */
function acquire(serial) {
  const current = sessions.get(serial)
  if (current && !current.dead) return current
  if (current) sessions.delete(serial)
  if (Date.now() < (cooldowns.get(serial) || 0)) return null
  cooldowns.delete(serial)
  return createSession(serial)
}

function write(session, cmd) {
  if (session.dead) return false
  session.inFlight += 1
  try {
    session.child.stdin.write(`${cmd}; echo .\n`)
    return true
  } catch {
    session.dead = true
    return false
  }
}

/** 设备空出来了：把攒下的最后一个位置补发出去 */
function flushMove(session) {
  if (session.dead || !session.pending) return
  if (session.inFlight >= MAX_IN_FLIGHT) return
  const p = session.pending
  session.pending = null
  write(session, `input motionevent MOVE ${p.x} ${p.y}`)
}

function scheduleIdle(session) {
  clearTimeout(session.idleTimer)
  // 手指还按着的时候不能按「抬手后闲置」的节奏收，否则长按会被从中间掐断
  const delay = session.pressing ? PRESS_GUARD_MS : IDLE_RELEASE_MS
  session.idleTimer = setTimeout(() => {
    if (session.pressing) {
      write(session, `input motionevent UP ${session.x} ${session.y}`)
      session.pressing = false
    }
    closeSession(session.serial)
  }, delay)
  if (session.idleTimer.unref) session.idleTimer.unref()
}

function closeSession(serial) {
  const session = sessions.get(serial)
  if (!session) return
  // 标记成计划内关闭，close 回调就不会给它挂冷却
  session.planned = true
  sessions.delete(serial)
  clearTimeout(session.idleTimer)
  try {
    session.child.stdin.end('exit\n')
  } catch {}
  const timer = setTimeout(() => {
    try {
      session.child.kill()
    } catch {}
  }, 300)
  if (timer.unref) timer.unref()
}

/**
 * 注入一段连续的触摸事件。down / move / up 走同一台设备的同一个 shell，
 * 所以设备看到的是「一次连续手势」，而不是三次孤立的点击。
 */
export function touchEvent(serial, { phase, x, y }) {
  const px = Math.round(Number(x) || 0)
  const py = Math.round(Number(y) || 0)

  /* down 是手势起点，必须尽力把通道建起来 */
  if (phase === 'down') {
    const session = acquire(serial)
    // 只有通道刚刚异常退出才会走到这里，此时确实处于重建窗口
    if (!session) return { ok: false, error: '触控通道正在重连' }

    // 上一次没正常抬手（页面刷新 / 断线）：先取消掉，避免叠出一个按死的手指
    if (session.pressing) {
      session.pressing = false
      write(session, `input motionevent CANCEL ${session.x} ${session.y}`)
    }
    session.pressing = true
    session.x = px
    session.y = py
    session.pending = null
    write(session, `input motionevent DOWN ${px} ${py}`)
    scheduleIdle(session)
    return { ok: true }
  }

  const session = sessions.get(serial)
  // 通道不在（正在空闲回收 / 刚异常退出）：拖动中的中间点直接丢掉即可，
  // 既不重新 spawn 也不报错 —— 下一笔手势的 down 会把通道重新建好
  if (!session || session.dead) return { ok: true }

  if (phase === 'move') {
    if (!session.pressing) return { ok: true }
    session.x = px
    session.y = py
    if (session.inFlight >= MAX_IN_FLIGHT) session.pending = { x: px, y: py }
    else write(session, `input motionevent MOVE ${px} ${py}`)
  } else if (phase === 'up' || phase === 'cancel') {
    if (!session.pressing) {
      scheduleIdle(session)
      return { ok: true }
    }
    session.pressing = false
    session.pending = null
    session.x = px
    session.y = py
    write(session, `input motionevent ${phase === 'up' ? 'UP' : 'CANCEL'} ${px} ${py}`)
  }

  scheduleIdle(session)
  return { ok: true }
}

/** 连接断了 / 换设备时兜底抬手，别让手指停在屏幕上 */
export function releaseTouch(serial) {
  const session = sessions.get(serial)
  if (!session || session.dead) return
  if (session.pressing) {
    write(session, `input motionevent UP ${session.x} ${session.y}`)
    session.pressing = false
  }
  scheduleIdle(session)
}

export function closeAllTouches() {
  for (const serial of [...sessions.keys()]) closeSession(serial)
}
