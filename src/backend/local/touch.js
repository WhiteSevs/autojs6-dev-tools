/**
 * 远程触控（纯前端版）：down / move / up 写进同一条常驻 `sh`，
 * 设备看到的是「一次连续手势」，而不是三次孤立的点击。
 *
 * 排队与回收逻辑和服务端 server/touch.js 一致：
 * 每条指令后面跟一个 echo，用收到的行数估算设备上还有几条没跑完，超出就丢掉中间的移动点。
 */
import { openShell } from './adb.js'

/** 抬手后这么久没有新事件就自动松开并收掉 shell，避免页面崩了留下「一直按着」 */
const IDLE_RELEASE_MS = 3000
/** 按住不动时的兜底（长按不该被空闲逻辑判成手势结束，所以窗口明显更长） */
const PRESS_GUARD_MS = 8000
/** 通道异常退出后的短暂退避，避免 adb 已经挂了还被事件风暴反复重建 */
const FAIL_COOLDOWN_MS = 400
/** 设备上允许排队的指令条数：3 条在途既跟手，又不会越拖越滞后 */
const MAX_IN_FLIGHT = 3

const sessions = new Map()
const cooldowns = new Map()

function createSession(serial) {
  const child = openShell(serial)
  const session = {
    serial,
    child,
    dead: false,
    planned: false,
    pressing: false,
    x: 0,
    y: 0,
    inFlight: 0,
    pending: null,
    idleTimer: null,
    error: '',
  }

  child.onData((text) => {
    const acks = text.split('\n').length - 1
    if (!acks) return
    session.inFlight = Math.max(0, session.inFlight - acks)
    flushMove(session)
  })
  child.onClose(() => {
    session.dead = true
    if (!session.planned) cooldowns.set(serial, Date.now() + FAIL_COOLDOWN_MS)
    if (sessions.get(serial) === session) sessions.delete(serial)
  })

  sessions.set(serial, session)
  return session
}

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
  const ok = session.child.write(`${cmd}; echo .\n`)
  if (!ok) {
    session.dead = true
    return false
  }
  return true
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
  const delay = session.pressing ? PRESS_GUARD_MS : IDLE_RELEASE_MS
  session.idleTimer = setTimeout(() => {
    if (session.pressing) {
      write(session, `input motionevent UP ${session.x} ${session.y}`)
      session.pressing = false
    }
    closeSession(session.serial)
  }, delay)
}

function closeSession(serial) {
  const session = sessions.get(serial)
  if (!session) return
  session.planned = true
  sessions.delete(serial)
  clearTimeout(session.idleTimer)
  try {
    session.child.write('exit\n')
    session.child.close()
  } catch {}
}

/** 注入一段连续的触摸事件 */
export function touchEvent(serial, { phase, x, y }) {
  const px = Math.round(Number(x) || 0)
  const py = Math.round(Number(y) || 0)

  /* down 是手势起点，必须尽力把通道建起来 */
  if (phase === 'down') {
    const session = acquire(serial)
    if (!session) return { ok: false, error: '触控通道正在重连' }
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
  // 通道不在（正在空闲回收 / 刚异常退出）：拖动中的中间点直接丢掉，下一笔手势会重建
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
