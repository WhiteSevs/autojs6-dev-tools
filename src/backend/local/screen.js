/**
 * 锁屏 / 解锁（纯前端版，逻辑与服务端 server/index.js 的 screenPower 一致）。
 *
 * - 锁屏靠 KEYCODE_POWER(26)，但它是个开关：屏幕本来就关着时再按会点亮，所以先探状态保证幂等。
 * - 解锁先保证亮屏，再上滑划开通知锁；**不调 `wm dismiss-keyguard`** ——
 *   实测小米平板（MIUI / Android 15）上那条命令会把屏幕直接灭掉，比不划还糟。
 * - 设了 PIN / 图案的设备系统不允许免密切分，这里最多把界面送到解锁页。
 */
import { exec } from './adb.js'
import { pngSize } from './raster.js'
import { capturePng } from './capture.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** serial -> 改动前的 stay_on_while_plugged_in 原值 */
const stayOnPatches = new Map()

const isAwake = (w) => w === 'Awake' || w === 'Dreaming'
const isScreenOn = (state) => state === 'ON'

/** 开启「插电保持唤醒」，只加 usb 这一位，别覆盖用户原有的 ac / wireless 设置 */
async function ensureStayAwake(serial) {
  if (stayOnPatches.has(serial)) return false
  try {
    const r = await exec(serial, 'settings get global stay_on_while_plugged_in')
    const raw = String(r.text || '').trim()
    const prev = Number.parseInt(raw, 10)
    const base = Number.isFinite(prev) ? prev : 0
    stayOnPatches.set(serial, Number.isFinite(prev) ? String(prev) : '0')
    if ((base & 2) !== 0) return false
    await exec(serial, `settings put global stay_on_while_plugged_in ${base | 2}`)
    return true
  } catch {
    return false
  }
}

/**
 * 读当前电源状态（Awake / Asleep / Dreaming）。
 * `grep` 刻意不带 `-m1`：它命中后立刻关管道，dumpsys 被 SIGPIPE 打死，
 * 有些设备上会收不到退出包而卡住。管道不可用时退回整段 `dumpsys power`。
 */
async function readWakefulness(serial) {
  const pick = (text) => String(text || '').match(/mWakefulness=(\w+)/)?.[1] || null
  try {
    const fast = pick((await exec(serial, 'dumpsys power | grep mWakefulness')).text)
    if (fast) return fast
  } catch {}
  try {
    const slow = pick((await exec(serial, 'dumpsys power', { timeout: 15000 })).text)
    if (slow) return slow
  } catch {}
  return null
}

/**
 * 屏幕是不是真的亮着。
 * 不能用 mWakefulness 代替：实测会出现 Awake 但面板已经灭了的情况（息屏计时器到点，CPU 还没睡）。
 * `dumpsys display` 的 mScreenState 才是面板状态，老系统没有这个字段时退回电源状态。
 */
async function readScreenState(serial) {
  try {
    const r = await exec(serial, 'dumpsys display | grep mScreenState=')
    const m = String(r.text || '').match(/mScreenState=(\w+)/)
    if (m) return m[1]
  } catch {}
  const wakefulness = await readWakefulness(serial)
  if (wakefulness === 'Asleep') return 'OFF'
  if (isAwake(wakefulness)) return 'ON'
  return 'UNKNOWN'
}

/** 锁屏是否还挡在前面：锁屏时焦点窗口是 NotificationShade，解锁后是当前 App */
async function keyguardShowing(serial) {
  try {
    const r = await exec(serial, 'dumpsys window | grep mCurrentFocus')
    return /NotificationShade/.test(String(r.text || ''))
  } catch {
    return false
  }
}

/** 上滑划开锁屏：这是用户本来的动作，比调系统接口可靠 */
async function swipeUpToUnlock(serial, size) {
  const w = Number(size?.width) || 0
  const h = Number(size?.height) || 0
  if (!w || !h) return false
  await exec(
    serial,
    `input swipe ${Math.round(w / 2)} ${Math.round(h * 0.82)} ${Math.round(w / 2)} ${Math.round(h * 0.32)} 180`,
  )
  return true
}

/**
 * 确保屏幕亮着。只用 KEYCODE_WAKEUP(224) —— 它只会亮不会灭。
 * 绝不能用 POWER(26) 兜底：那是个开关，一旦状态读慢了（刚点亮但 dumpsys 还没刷新），
 * 26 会把刚亮的屏幕又关掉，表现就是「点了解锁结果屏幕更黑了」。
 */
async function wakeScreen(serial) {
  if (isScreenOn(await readScreenState(serial))) return { ok: true, woke: false }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await exec(serial, 'input keyevent 224')
    // 面板点亮有延迟：给短了会以为没醒
    await sleep(900)
    if (isScreenOn(await readScreenState(serial))) {
      // 亮起来之后还要等它画完第一帧，输入焦点才会从 NotificationShade 切回前台应用
      await sleep(600)
      return { ok: true, woke: true }
    }
  }
  return { ok: false, woke: true }
}

/** adb / shell 的原始报错对用户没什么用，能认出来的就翻译成一句人话 */
function explainShellFailure(text) {
  const raw = String(text || '').trim()
  if (/not found|no devices|device offline/i.test(raw)) {
    return '设备已断开：可能重新插拔过，刷新设备列表后重试'
  }
  return raw || '执行失败'
}

export async function screenPower(serial, action) {
  const screenState = await readScreenState(serial)

  if (action === 'lock') {
    if (!isScreenOn(screenState)) return { ok: true, message: '屏幕已经处于关闭状态' }
    const r = await exec(serial, 'input keyevent 26')
    return { ok: r.code === 0, message: r.code === 0 ? '已锁屏' : explainShellFailure(r.text) }
  }

  // 顺序很重要：先把「插电常亮」打开，再唤醒。
  // 注入的输入事件不会重置系统的息屏计时器，晚一步打开的话屏幕刚亮就被计时器关掉。
  const stayOn = await ensureStayAwake(serial)
  const suffix = stayOn ? '（已开启「充电时保持唤醒」，离开页面时还原）' : ''

  const wake = await wakeScreen(serial)
  if (!wake.ok) {
    return { ok: false, message: `没能点亮屏幕：设备不响应唤醒键，请手动按一下电源键${suffix}` }
  }

  if (wake.woke) await sleep(600)
  const locked = await keyguardShowing(serial)
  if (!locked) return { ok: true, message: `已解锁${suffix}` }

  let size = null
  try {
    size = pngSize(await capturePng(serial))
  } catch {}
  await swipeUpToUnlock(serial, size)
  await sleep(700)
  if (!(await keyguardShowing(serial))) return { ok: true, message: `已解锁${suffix}` }

  return { ok: true, message: `已亮屏，但锁屏没划开：设了密码 / 图案时需要手动输入${suffix}` }
}

/** 离开页面 / 切换设备时把改过的设置还原回去，别在用户设备上留改动 */
export async function restoreStayAwake() {
  if (!stayOnPatches.size) return
  for (const [serial, prev] of [...stayOnPatches.entries()]) {
    stayOnPatches.delete(serial)
    try {
      await exec(serial, `settings put global stay_on_while_plugged_in ${prev}`)
    } catch {}
  }
}
