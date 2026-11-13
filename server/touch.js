import { spawn } from 'node:child_process'

const ADB_BIN = process.env.ADB_PATH || 'adb'

/** 手势结束后这么久没有新事件就自动松开并收掉 shell，避免前端崩了留下「一直按着」 */
const IDLE_RELEASE_MS = 1500
/**
 * 设备上允许排队的指令条数。
 * 实测：持久 shell 里一条 `input motionevent` 从写入到 ack 回来约 98ms（其中设备执行约 35ms，
 * 其余是 adb 管道的往返），所以放 3 条在途既能跟手，又不会因为慢就疯狂堆积。
 * 超出后前端发来的中间点会被直接丢掉，只保留最新位置。
 */
const MAX_IN_FLIGHT = 3

/** serial -> session */
const sessions = new Map()
/** serial -> 冷却截止时间：通道刚挂掉时别每来一个事件就重新 spawn 一个 adb shell */
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
  })
  child.on('close', () => {
    session.dead = true
    cooldowns.set(serial, Date.now() + 1000)
    if (sessions.get(serial) === session) sessions.delete(serial)
  })
  // adb 没了也要让 write 失败得干净，而不是抛未捕获异常
  child.stdin.on('error', () => {
    session.dead = true
  })

  sessions.set(serial, session)
  return session
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
  session.idleTimer = setTimeout(() => {
    if (session.pressing) {
      write(session, `input motionevent UP ${session.x} ${session.y}`)
      session.pressing = false
    }
    closeSession(session.serial)
  }, IDLE_RELEASE_MS)
  if (session.idleTimer.unref) session.idleTimer.unref()
}

function closeSession(serial) {
  const session = sessions.get(serial)
  if (!session) return
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
  const until = cooldowns.get(serial) || 0
  if (!sessions.has(serial) && Date.now() < until) return { ok: false, error: '触控通道正在重连' }

  const session = sessions.get(serial) || createSession(serial)
  if (session.dead) return { ok: false, error: session.error || 'adb shell 已退出' }

  const px = Math.round(Number(x) || 0)
  const py = Math.round(Number(y) || 0)

  if (phase === 'down') {
    // 上一次没正常抬手（页面刷新 / 断线）：先取消掉，避免叠出一个按死的手指
    if (session.pressing) write(session, `input motionevent CANCEL ${session.x} ${session.y}`)
    session.pressing = true
    session.x = px
    session.y = py
    session.pending = null
    write(session, `input motionevent DOWN ${px} ${py}`)
  } else if (phase === 'move') {
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
  if (!session) return
  if (session.pressing) {
    write(session, `input motionevent UP ${session.x} ${session.y}`)
    session.pressing = false
  }
  scheduleIdle(session)
}

export function closeAllTouches() {
  for (const serial of [...sessions.keys()]) closeSession(serial)
}
