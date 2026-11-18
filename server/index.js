import { WebSocketServer } from 'ws'
import { runAdb } from './adb.js'
import * as engine from './engine.js'
import {
  cropRegion,
  encodeFrame,
  findColorOnFrame,
  normalizeImage,
  readPixel,
  readSize,
  renderDemoFrame,
} from './frame.js'
import { fitRecordSize, looksLikeArgError } from './record.js'
import { closeAllTouches, releaseTouch, touchEvent } from './touch.js'

const DEMO_SERIAL = 'demo'

/** 无线调试（配对 / mDNS）长在 adb 上，只有 adb 引擎能做 */
const adbEngine = engine.engineById('adb')

/** 当前引擎的对外描述：前端据此显示「已就绪」与不可用原因 */
async function engineEnv() {
  const st = await engine.status()
  const cur = st.engines.find((e) => e.id === st.current) || {}
  return {
    ok: !!cur.ok,
    version: cur.ok ? (cur.id === 'adb' ? cur.detail : `USB 直连 · ${cur.detail}`) : '',
    adbPath: cur.id === 'adb' ? cur.path || '' : '',
    error: cur.ok ? '' : cur.error || '',
    hint: cur.hint || '',
    engine: st.current,
    engineLabel: cur.label || '',
    engineShort: cur.short || '',
    engines: st.engines,
    platform: process.platform,
    node: process.version,
  }
}

/**
 * 当前引擎不支持某项能力时统一返回这个。
 * soft=true 用于「发现类」接口（mDNS）：前端按 supported=false 自行隐藏列表；
 * 其余（配对 / 连接）返回 ok=false，前端会直接把 error 弹出来。
 */
function unsupported(res, feature, { soft = false } = {}) {
  const message = `当前连接引擎不支持${feature}，切到「ADB 命令」后可用`
  if (soft) {
    return sendJson(res, { ok: true, supported: false, reason: 'engine', message, services: [] })
  }
  return sendJson(res, { ok: false, error: message }, 400)
}

/* --------------------- 本地图片数据源（作为伪设备参与取色/找色） --------------------- */
const imageStore = new Map()
const MAX_IMAGES = 4
let imageSeq = 0

function getStoredImage(serial) {
  const img = imageStore.get(serial)
  if (!img) return null
  img.at = Date.now()
  return img.buffer
}

function storeImage(buffer, width, height, name, format) {
  const id = `file:${(++imageSeq).toString(36)}`
  imageStore.set(id, { buffer, width, height, name, format, at: Date.now() })
  while (imageStore.size > MAX_IMAGES) {
    let oldestKey = null
    let oldestAt = Infinity
    for (const [k, v] of imageStore) {
      if (v.at < oldestAt) {
        oldestAt = v.at
        oldestKey = k
      }
    }
    if (!oldestKey) break
    imageStore.delete(oldestKey)
  }
  return id
}

/* ------------------------------ 截屏缓存 ------------------------------ */
const pngCache = new Map() // serial -> { buffer, at, promise }

function getPng(serial, { maxAge = 800, force = false } = {}) {
  const stored = getStoredImage(serial)
  if (stored) return Promise.resolve(stored)

  const hit = pngCache.get(serial)
  if (!force && hit && Date.now() - hit.at < maxAge) return hit.promise

  const promise = (async () => {
    if (serial === DEMO_SERIAL) return renderDemoFrame()
    return engine.current().screenshot(serial)
  })()

  pngCache.set(serial, { at: Date.now(), promise })
  promise.catch(() => {
    const cur = pngCache.get(serial)
    if (cur && cur.promise === promise) pngCache.delete(serial)
  })
  return promise
}

function sendImage(res, buffer, { contentType = 'image/png', filename = 'image.png' } = {}) {
  res.statusCode = 200
  res.setHeader('Content-Type', contentType)
  res.setHeader('Content-Length', buffer.length)
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`)
  res.end(buffer)
}

/* --------------------------- 帧快照（对应前端所见画面） --------------------------- */
const frameStore = new Map()
const MAX_FRAMES = 6
let frameSeq = 0

function storeFrame(serial, buffer) {
  const id = ++frameSeq
  const list = frameStore.get(serial) || []
  list.push({ id, buffer, at: Date.now() })
  while (list.length > MAX_FRAMES) list.shift()
  frameStore.set(serial, list)
  return id
}

function getFrame(serial, id) {
  if (!id) return null
  const list = frameStore.get(serial) || []
  const hit = list.find((f) => f.id === Number(id))
  return hit ? hit.buffer : null
}

async function resolvePng(serial, frameId, { fresh = false } = {}) {
  const frame = getFrame(serial, frameId)
  if (frame) return frame
  // 录屏模式下没有服务端帧缓冲，取色 / 找色一律现截一帧，保证像素无损
  if (fresh) return getPng(serial, { force: true })
  // 环形缓冲被挤掉时，优先复用最近一次抓取结果，避免每次都重新截屏
  return getPng(serial, { maxAge: 2500 })
}

/* ------------------------------ 工具函数 ------------------------------ */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function sendJson(res, data, status = 200) {
  const body = JSON.stringify(data)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(body)
}

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        reject(new Error(`请求体过大（上限 ${Math.round(limit / 1024 / 1024)}MB）`))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim()
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

/* ------------------------------ 保持常亮 ------------------------------ */
/**
 * serial -> 改动前的 stay_on_while_plugged_in 原值。
 * 解锁必须配这个：注入式唤醒不会重置系统的休眠计时器，屏幕刚亮就会因为「早就该睡了」立刻熄掉，
 * 表现就是"点亮了但一秒后又黑"。插着 USB 时把这一位置起来，屏幕才会真的待在那儿。
 */
const stayOnPatches = new Map()

/** 开启「插电保持唤醒」，只加 usb 这一位，别覆盖用户原有的 ac / wireless 设置 */
async function ensureStayAwake(eng, serial) {
  if (stayOnPatches.has(serial)) return false
  try {
    const r = await eng.shellText(serial, 'settings get global stay_on_while_plugged_in')
    const raw = String(r.text || '').trim()
    const prev = Number.parseInt(raw, 10)
    const base = Number.isFinite(prev) ? prev : 0
    stayOnPatches.set(serial, Number.isFinite(prev) ? String(prev) : '0')
    if ((base & 2) !== 0) return false // 已经是插电常亮了，不用改
    await eng.shellText(serial, `settings put global stay_on_while_plugged_in ${base | 2}`)
    return true
  } catch {
    return false
  }
}

/** 服务关闭 / 退出时把改过的设置还原回去，别在用户设备上留改动 */
export async function restoreStayAwake() {
  if (!stayOnPatches.size) return
  const eng = engine.current()
  for (const [serial, prev] of [...stayOnPatches.entries()]) {
    stayOnPatches.delete(serial)
    try {
      await eng.shellText(serial, `settings put global stay_on_while_plugged_in ${prev}`)
    } catch {}
  }
}

/* ------------------------------ 锁屏 / 解锁 ------------------------------ */
/**
 * 读当前电源状态（Awake / Asleep / Dreaming）。
 *
 * 先用带管道的快命令（实测 ~160ms），`grep` 刻意不带 `-m1`：它命中后立刻关管道，
 * dumpsys 被 SIGPIPE 打死，USB 直连引擎上会收不到退出包而卡住（实测 8s 都回不来）。
 * 管道在个别 ROM 上不可用时，退回整段 `dumpsys power`（~750ms、220KB+，稳但慢）。
 * 都探不到返回 null，交给调用方按「状态未知」处理，而不是猜成「已亮屏」。
 */
async function readWakefulness(eng, serial) {
  const pick = (text) => String(text || '').match(/mWakefulness=(\w+)/)?.[1] || null

  try {
    const fast = pick((await eng.shellText(serial, 'dumpsys power | grep mWakefulness')).text)
    if (fast) return fast
  } catch {}

  try {
    const slow = pick((await eng.shellText(serial, 'dumpsys power', { timeout: 15000 })).text)
    if (slow) return slow
  } catch {}

  return null
}

const isAwake = (w) => w === 'Awake' || w === 'Dreaming'

/**
 * 屏幕是不是真的亮着。
 * 不能用 `mWakefulness` 代替：实测这台平板会出现 `mWakefulness=Awake` 但面板已经灭了的情况
 * （息屏计时器到点，CPU 还没睡），照它判断就会以为"已经亮着"而跳过唤醒。
 * `dumpsys display` 的 `mScreenState` 才是面板状态，老系统没有这个字段时退回电源状态。
 */
async function readScreenState(eng, serial) {
  try {
    const r = await eng.shellText(serial, 'dumpsys display | grep mScreenState=')
    const m = String(r.text || '').match(/mScreenState=(\w+)/)
    if (m) return m[1]
  } catch {}
  const wakefulness = await readWakefulness(eng, serial)
  if (wakefulness === 'Asleep') return 'OFF'
  if (isAwake(wakefulness)) return 'ON'
  return 'UNKNOWN'
}

const isScreenOn = (state) => state === 'ON'

/** 锁屏是否还挡在前面：锁屏时焦点窗口是 NotificationShade，解锁后是当前 App */
async function keyguardShowing(eng, serial) {
  try {
    const r = await eng.shellText(serial, 'dumpsys window | grep mCurrentFocus')
    return /NotificationShade/.test(String(r.text || ''))
  } catch {
    return false
  }
}

/** 当前这一帧的真实尺寸：`wm size` 给的是面板物理尺寸，横屏时不会跟着转，滑动坐标得按实际画面算 */
async function currentScreenSize(serial) {
  try {
    return await readSize(await getPng(serial, { force: true }))
  } catch {
    return null
  }
}

/** 上滑划开锁屏：这是用户本来的动作，比调系统接口可靠 */
async function swipeUpToUnlock(serial) {
  const size = await currentScreenSize(serial)
  const w = Number(size?.width) || 0
  const h = Number(size?.height) || 0
  if (!w || !h) return false
  const eng = engine.current()
  await eng.swipe(serial, {
    x1: Math.round(w / 2),
    y1: Math.round(h * 0.82),
    x2: Math.round(w / 2),
    y2: Math.round(h * 0.32),
    duration: 180,
  })
  return true
}

/** adb / shell 的原始报错对用户没什么用，能认出来的就翻译成一句人话 */
function explainShellFailure(text) {
  const raw = String(text || '').trim()
  if (/not found|no devices|device offline/i.test(raw)) {
    return '设备已断开：可能重新插拔过，刷新设备列表后重试'
  }
  return raw || '执行失败'
}

/**
 * 确保屏幕亮着。
 * 先发 KEYCODE_WAKEUP（只亮不灭，最安全）；部分 ROM 不响应注入的 WAKEUP，就退回电源键 ——
 * 此时已经确认是熄屏状态，按 26 只会点亮，不会把屏幕关掉。每步都回读状态，别靠猜。
 */
/**
 * 确保屏幕亮着。
 * 只用 KEYCODE_WAKEUP(224) —— 它只会亮不会灭。绝不能用 POWER(26) 兜底：
 * 那是个开关，一旦状态读慢了（刚点亮但 dumpsys 还没刷新），26 会把刚亮的屏幕又关掉，
 * 表现就是"点了解锁结果屏幕更黑了"。宁可多试一次 224。
 */
async function wakeScreen(eng, serial) {
  if (isScreenOn(await readScreenState(eng, serial))) return { ok: true, woke: false }

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await eng.shellText(serial, 'input keyevent 224')
    // 面板点亮有延迟：实测这台平板要 ~2s 才真正亮起来，给短了会以为没醒
    await sleep(900)
    if (isScreenOn(await readScreenState(eng, serial))) {
      // 亮起来之后还要等它画完第一帧，输入焦点才会从 NotificationShade 切回前台应用
      await sleep(600)
      return { ok: true, woke: true }
    }
  }
  return { ok: false, woke: true }
}

/**
 * 锁屏 / 解锁屏幕。
 * - 锁屏靠 KEYCODE_POWER(26)，但它是个开关：屏幕本来就关着时再按会点亮，所以先探状态保证幂等。
 * - 解锁先保证亮屏，再 `wm dismiss-keyguard` 划开通知锁；老系统没这个子命令时退回上滑手势。
 * - 设了 PIN / 图案的设备，系统不允许免密划开，这里最多把界面送到解锁页。
 */
async function screenPower(serial, action) {
  if (serial === DEMO_SERIAL) {
    return { ok: true, message: action === 'lock' ? '演示模式：已模拟锁屏' : '演示模式：已模拟解锁' }
  }
  const eng = engine.current()
  const screenState = await readScreenState(eng, serial)

  if (action === 'lock') {
    // 用面板状态判断，不能用 mWakefulness：Awake 但面板已灭时再按 POWER 会把屏幕点亮
    if (!isScreenOn(screenState)) return { ok: true, message: '屏幕已经处于关闭状态' }
    const r = await eng.shellText(serial, 'input keyevent 26')
    return {
      ok: r.code === 0,
      message: r.code === 0 ? '已锁屏' : explainShellFailure(r.text),
    }
  }

  // 顺序很重要：先把「插电常亮」打开，再唤醒。
  // 注入的输入事件不会重置系统的息屏计时器（实测这台机器只有 10s），
  // 晚一步打开的话屏幕刚亮就被计时器关掉，看起来就是"解锁了但一片黑"。
  const stayOn = await ensureStayAwake(eng, serial)
  const suffix = stayOn ? '（已开启「充电时保持唤醒」，关服务时还原）' : ''

  const wake = await wakeScreen(eng, serial)
  if (!wake.ok) {
    return { ok: false, message: `没能点亮屏幕：设备不响应唤醒键，请手动按一下电源键${suffix}` }
  }

  // 唤醒之后先等第一帧画完，再判断有没有锁屏。
  // 这段顺序是踩出来的：刚点亮时焦点还挂在 NotificationShade 上，
  // 过早判断会误以为"还锁着"，接着去划屏 / 调 dismiss-keyguard，
  // 而那些操作在部分 ROM 上反而会把刚亮的屏幕关掉。
  if (wake.woke) await sleep(600)
  const locked = await keyguardShowing(eng, serial)

  if (!locked) return { ok: true, message: `已解锁${suffix}` }

  // 确实停在锁屏上：先按用户的真实动作上滑一次，不行就如实说明。
  // 这里不再调 `wm dismiss-keyguard` —— 实测小米平板会把屏幕直接灭掉，比不划还糟。
  await swipeUpToUnlock(serial)
  await sleep(700)
  if (!(await keyguardShowing(eng, serial))) return { ok: true, message: `已解锁${suffix}` }

  return { ok: true, message: `已亮屏，但锁屏没划开：设了密码 / 图案时需要手动输入${suffix}` }
}

/** 探测单台设备信息：USB 直连时要先认证，未授权会一直等手机确认，所以加个上限 */function withTimeout(promise, ms, label) {
  let timer
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}超时（${ms}ms）`)), ms)
    }),
  ])
}

async function enrichDevices() {
  const eng = engine.current()
  const devices = await eng.devices()
  const enriched = []
  for (const d of devices) {
    const base = d.model || d.mdnsName || d.serial
    // mDNS 设备的序列号是一长串 adb-xxx-yyy._tcp，直接塞进下拉框没法看，统一标成「无线调试」
    const label =
      d.kind === 'mdns' ? `${base}（无线调试）` : d.model ? `${d.model} (${d.serial})` : d.serial
    const item = { ...d, label, ready: d.state === 'device' }
    if (item.ready) {
      try {
        const info = await withTimeout(eng.info(d.serial), 6000, '读取设备信息')
        item.screen = info.screen
        item.brand = info.brand
        item.androidVersion = info.androidVersion
        item.model = item.model || info.model
      } catch {
        item.screen = null
      }
    }
    enriched.push(item)
  }
  enriched.push({
    serial: DEMO_SERIAL,
    state: 'demo',
    kind: 'demo',
    model: '演示模式（无需设备）',
    label: '演示模式（无需设备）',
    ready: true,
    screen: { width: 1080, height: 1920 },
    brand: 'AutoJs6 DevHelper',
    androidVersion: '',
  })
  return enriched
}

/* ------------------------------ mDNS 局域网设备 ------------------------------ */
/**
 * 把 mDNS 原始记录按「设备 + 服务类型」聚合：
 * 同一台设备常留下多个端口的旧记录（等 TTL 过期），前端按 addresses 顺序逐个试连即可。
 */
function groupLanServices(services, connectedSerials = new Set()) {
  const groups = new Map()
  for (const s of services) {
    if (s.kind === 'other') continue
    const key = `${s.kind}|${s.deviceKey}`
    let group = groups.get(key)
    if (!group) {
      group = {
        kind: s.kind,
        name: s.name,
        deviceKey: s.deviceKey,
        host: s.host,
        address: s.address,
        port: s.port,
        addresses: [],
        connected: false,
      }
      groups.set(key, group)
    }
    if (!group.addresses.includes(s.address)) group.addresses.push(s.address)
    if (connectedSerials.has(s.address)) group.connected = true
  }
  // 可直连的排在待配对的前面；同类里已在线的排前面
  return [...groups.values()].sort((a, b) => {
    if (a.connected !== b.connected) return a.connected ? -1 : 1
    if (a.kind !== b.kind) return a.kind === 'connect' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

/* ------------------------------ 路由处理 ------------------------------ */
async function handleApi(req, res, url) {
  const p = url.pathname
  const q = url.searchParams

  if (p === '/api/env') {
    return sendJson(res, await engineEnv())
  }

  /* ------------------------------ 连接引擎设置 ------------------------------ */
  if (p === '/api/settings') {
    if (req.method === 'POST') {
      const body = await readBody(req)
      const id = String(body.engine || '').trim()
      if (!id) return sendJson(res, { ok: false, error: '缺少 engine' }, 400)
      if (!engine.engineById(id)) return sendJson(res, { ok: false, error: `未知的连接引擎：${id}` }, 400)
      const st = await engine.setEngine(id)
      // 切换引擎后旧引擎的画面缓存全失效：设备可能连型号都不同，不能让前端拿到上一台设备的帧
      pngCache.clear()
      frameStore.clear()
      return sendJson(res, { ok: true, ...st, env: await engineEnv() })
    }
    const st = await engine.status()
    return sendJson(res, { ok: true, ...st, env: await engineEnv() })
  }

  /**
   * 释放 adb server 对 USB 接口的独占。
   * 「USB 直连」现在跑在浏览器里（WebUSB），而 adb server 握着接口时浏览器根本 claim 不到
   * （Windows 上就是 error 5）。浏览器自己没法执行 adb 命令，所以切换引擎时让服务端代劳；
   * adb 需要时会自动把 server 再拉起来。
   */
  if (p === '/api/release-adb' && req.method === 'POST') {
    const r = await engine.releaseAdbServer()
    return sendJson(res, { ok: r.ok, message: r.message })
  }

  if (p === '/api/devices') {
    const env = await engineEnv()
    if (!env.ok) return sendJson(res, { ok: false, adb: env, error: env.error || '连接引擎不可用', devices: [] })
    try {
      const devices = await enrichDevices()
      return sendJson(res, { ok: true, adb: env, devices })
    } catch (err) {
      return sendJson(res, { ok: false, adb: env, error: err.message, devices: [] })
    }
  }

  // 局域网设备发现：adb 编了 mdns 支持就用 mDNS 扫（Android 11+ 无线调试），否则 supported=false
  if (p === '/api/mdns') {
    if (!engine.current().capabilities.mdns) return unsupported(res, '局域网设备发现', { soft: true })
    const force = q.get('refresh') === '1'
    const probe = await adbEngine.mdns.check({ force })
    if (!probe.ok) {
      return sendJson(res, {
        ok: true,
        supported: false,
        reason: probe.reason,
        message: probe.message,
        services: [],
      })
    }
    try {
      const result = await adbEngine.mdns.services({ force })
      let known = []
      try {
        known = await adbEngine.devices()
      } catch {}
      const serialSet = new Set(known.map((d) => d.serial))
      const byHost = new Map()
      /** 已经在线（已连上）的 mDNS 设备：serial 是 adb-xxx._adb-tls-connect._tcp，只能按设备 id 对 */
      const readyMdns = new Map()
      for (const d of known) {
        if (d.state !== 'device') continue
        if (d.kind === 'network') {
          const host = d.serial.split(':')[0]
          if (host && !byHost.has(host)) byHost.set(host, d)
        } else if (d.kind === 'mdns' && d.mdnsName) {
          const key = d.mdnsName.split('-').slice(0, 2).join('-').toLowerCase()
          if (key) readyMdns.set(key, d)
        }
      }
      const services = groupLanServices(result.services, serialSet).map((g) => {
        const hit = byHost.get(g.host) || readyMdns.get(g.deviceKey)
        return {
          ...g,
          model: hit?.model || '',
          serial: hit?.serial || '',
          connected: g.connected || readyMdns.has(g.deviceKey),
          online: !!hit && hit.state === 'device',
        }
      })
      return sendJson(res, { ok: true, supported: true, services })
    } catch (err) {
      return sendJson(res, { ok: true, supported: true, error: err.message, services: [] })
    }
  }

  // 无线调试配对：6 位配对码来自设备屏幕上的「使用配对码配对设备」
  if (p === '/api/pair' && req.method === 'POST') {
    if (!engine.current().capabilities.wireless) return unsupported(res, '无线调试配对')
    const body = await readBody(req)
    const address = String(body.address || '').trim()
    const code = String(body.code || '').replace(/\D/g, '')
    if (!address) return sendJson(res, { ok: false, error: '缺少 address' }, 400)
    if (code.length !== 6) return sendJson(res, { ok: false, error: '配对码应为 6 位数字' }, 400)
    const r = await adbEngine.pair(address, code)
    return sendJson(res, r)
  }

  if (p === '/api/connect' && req.method === 'POST') {
    if (!engine.current().capabilities.wireless) return unsupported(res, '无线连接')
    const body = await readBody(req)
    if (!body.address) return sendJson(res, { ok: false, error: '缺少 address' }, 400)
    const r = await adbEngine.connect(String(body.address).trim())
    if (r.ok) {
      try { await runAdb(['-s', String(body.address).trim(), 'wait-for-device'], { timeout: 8000 }) } catch {}
    }
    return sendJson(res, r)
  }

  if (p === '/api/disconnect' && req.method === 'POST') {
    if (!engine.current().capabilities.wireless) return unsupported(res, '无线连接')
    const body = await readBody(req)
    const r = await adbEngine.disconnect(String(body.address || '').trim())
    return sendJson(res, r)
  }

  // 上传本地图片作为数据源
  if (p === '/api/image' && req.method === 'POST') {
    const body = await readBody(req, 64 * 1024 * 1024)
    const raw = String(body.dataUrl || '')
    const match = raw.match(/^data:[^;]+;base64,(.+)$/s)
    const base64 = (match ? match[1] : raw).trim()
    if (!base64) return sendJson(res, { ok: false, error: '缺少图片数据' }, 400)

    const buf = Buffer.from(base64, 'base64')
    if (!buf.length) return sendJson(res, { ok: false, error: '图片数据为空' }, 400)

    const normalized = await normalizeImage(buf)
    const name = String(body.name || 'image').slice(0, 120)
    const serial = storeImage(normalized.buffer, normalized.width, normalized.height, name, normalized.format)

    return sendJson(res, {
      ok: true,
      serial,
      name,
      width: normalized.width,
      height: normalized.height,
      format: normalized.format,
      bytes: normalized.buffer.length,
    })
  }

  if (p === '/api/info') {
    const serial = q.get('serial') || DEMO_SERIAL
    if (serial === DEMO_SERIAL) {
      return sendJson(res, {
        ok: true,
        demo: true,
        serial,
        model: '演示模式',
        brand: 'AutoJs6 DevHelper',
        androidVersion: '',
        sdk: '',
        screen: { width: 1080, height: 1920 },
        physical: { width: 1080, height: 1920 },
        override: null,
        density: 480,
      })
    }
    const info = await engine.current().info(serial, { force: q.get('force') === '1' })
    return sendJson(res, { ok: true, demo: false, ...info })
  }

  if (p === '/api/snapshot') {
    const serial = q.get('serial') || DEMO_SERIAL
    const png = await getPng(serial, { force: true })
    const frame = await encodeFrame(png, { scale: Number(q.get('scale') || 1) })
    sendImage(res, frame.buffer, {
      contentType: 'image/png',
      filename: `screenshot-${serial}-${Date.now()}.png`,
    })
    return
  }

  // 整屏 / 区域截图（1:1 原始像素，PNG 无损）
  if (p === '/api/shot' && req.method === 'POST') {
    const body = await readBody(req)
    const serial = body.serial || DEMO_SERIAL
    const png = body.fresh ? await getPng(serial, { force: true }) : await resolvePng(serial, body.frameId)
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)

    if (body.region && Number.isFinite(Number(body.region.w ?? body.region.width))) {
      const result = await cropRegion(png, body.region)
      sendImage(res, result.buffer, {
        contentType: 'image/png',
        filename: `region-${result.x},${result.y}-${result.width}x${result.height}-${stamp}.png`,
      })
      return
    }

    // 未指定区域 = 保存整屏：直接把原始 PNG 字节发回去，字节级一致且省一次重编码
    sendImage(res, png, {
      contentType: 'image/png',
      filename: `screenshot-${serial}-${stamp}.png`,
    })
    return
  }

  if (p === '/api/pixel') {
    const serial = q.get('serial') || DEMO_SERIAL
    const x = Number(q.get('x'))
    const y = Number(q.get('y'))
    if (!Number.isFinite(x) || !Number.isFinite(y)) return sendJson(res, { ok: false, error: 'x/y 无效' }, 400)
    const png = await resolvePng(serial, q.get('frame'))
    const px = await readPixel(png, x, y)
    return sendJson(res, { ok: true, ...px })
  }

  if (p === '/api/pick' && req.method === 'POST') {
    const body = await readBody(req)
    const serial = body.serial || DEMO_SERIAL
    const png = await resolvePng(serial, body.frameId, { fresh: !!body.fresh })
    const px = await readPixel(png, Number(body.x), Number(body.y))
    return sendJson(res, { ok: true, ...px })
  }

  if (p === '/api/findColor' && req.method === 'POST') {
    const body = await readBody(req)
    const serial = body.serial || DEMO_SERIAL
    const png = await resolvePng(serial, body.frameId, { fresh: !!body.fresh })
    const result = await findColorOnFrame(png, {
      color: body.color,
      threshold: body.threshold ?? 4,
      region: body.region || null,
      limit: body.limit ?? 500,
    })
    return sendJson(res, { ok: true, ...result })
  }

  if (p === '/api/tap' && req.method === 'POST') {
    const body = await readBody(req)
    if (body.serial === DEMO_SERIAL) return sendJson(res, { ok: true, message: '演示模式：已模拟点击' })
    const r = await engine.current().tap(body.serial, Math.round(body.x), Math.round(body.y))
    return sendJson(res, { ok: r.ok, message: r.message || `tap ${body.x},${body.y}` })
  }

  if (p === '/api/swipe' && req.method === 'POST') {
    const body = await readBody(req)
    if (body.serial === DEMO_SERIAL) return sendJson(res, { ok: true, message: '演示模式：已模拟滑动' })
    const r = await engine.current().swipe(body.serial, {
      x1: Math.round(body.x1),
      y1: Math.round(body.y1),
      x2: Math.round(body.x2),
      y2: Math.round(body.y2),
      duration: Math.round(body.duration ?? 300),
    })
    return sendJson(res, { ok: r.ok, message: r.message || 'swipe done' })
  }

  // 长按拖拽（排序 / 拖放）：普通 swipe 的移动从按下就开始，长按计时会被打断，必须走 draganddrop
  if (p === '/api/drag' && req.method === 'POST') {
    const body = await readBody(req)
    if (body.serial === DEMO_SERIAL) return sendJson(res, { ok: true, message: '演示模式：已模拟长按拖拽' })
    const r = await engine.current().dragDrop(body.serial, {
      x1: Math.round(body.x1),
      y1: Math.round(body.y1),
      x2: Math.round(body.x2),
      y2: Math.round(body.y2),
      duration: Math.round(body.duration ?? 800),
    })
    return sendJson(res, { ok: r.ok, message: r.message || 'drag done' })
  }

  if (p === '/api/key' && req.method === 'POST') {
    const body = await readBody(req)
    if (body.serial === DEMO_SERIAL) return sendJson(res, { ok: true, message: `演示模式：已模拟按键 ${body.key}` })
    const r = await engine.current().key(body.serial, body.key)
    return sendJson(res, { ok: r.ok, message: r.message || `key ${body.key}` })
  }

  // 锁屏 / 解锁屏幕（解锁最多送到解锁页：设了密码 / 图案的设备系统不允许免密切断）
  if (p === '/api/screen' && req.method === 'POST') {
    const body = await readBody(req)
    const serial = String(body.serial || '').trim()
    const action = String(body.action || '').trim()
    if (!serial) return sendJson(res, { ok: false, error: '缺少 serial' }, 400)
    if (action !== 'lock' && action !== 'unlock') {
      return sendJson(res, { ok: false, error: 'action 只能是 lock 或 unlock' }, 400)
    }
    try {
      const r = await screenPower(serial, action)
      // 前端把 ok:false 当成失败，并且只认 error 字段，这里补一下，别让真正的原因被「请求失败」盖掉
      return sendJson(res, r.ok ? r : { ...r, error: r.message || '操作失败' })
    } catch (err) {
      return sendJson(res, { ok: false, error: err.message || String(err) }, 500)
    }
  }

  if (p === '/api/size') {
    const serial = q.get('serial') || DEMO_SERIAL
    const png = await getPng(serial, { maxAge: 800 })
    const size = await readSize(png)
    return sendJson(res, { ok: true, ...size })
  }

  return sendJson(res, { ok: false, error: `未知接口：${p}` }, 404)
}

/* ------------------------------ WebSocket 推流 ------------------------------ */
/** 码率夹到 0.5 ~ 100 Mbps（100 Mbps 是本工具对外支持的上限），避免手滑填出离谱的值 */
function clampBitrate(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return 100_000_000
  return Math.max(500_000, Math.min(100_000_000, Math.round(n)))
}

/** 触控报错节流：拖动时每秒几十个事件，真出错了也只提示一次 */
let touchErrorAt = 0

function attachWebSocket(httpServer) {
  const wss = new WebSocketServer({ noServer: true })

  httpServer.on('upgrade', (req, socket, head) => {
    let url
    try {
      url = new URL(req.url, 'http://127.0.0.1')
    } catch {
      return
    }
    if (url.pathname !== '/ws/screen') return
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, url))
  })

  wss.on('connection', (ws, req, url) => {
    const q = url.searchParams
    let serial = q.get('serial') || DEMO_SERIAL
    const levelRaw = q.get('level')
    const levelParam = levelRaw === null ? NaN : Number(levelRaw)
    const cfg = {
      mode: q.get('mode') === 'record' ? 'record' : 'screencap',
      fps: Math.max(1, Math.min(10, Number(q.get('fps')) || 2)),
      scale: Math.max(1, Math.min(8, Math.round(Number(q.get('scale')) || 3))),
      compressionLevel: Number.isFinite(levelParam) ? Math.max(0, Math.min(9, Math.round(levelParam))) : 3,
      bitrate: clampBitrate(q.get('bitrate')),
      paused: false,
    }

    let closed = false
    /** 管道版本号：切设备 / 换来源 / 改录制参数时 +1，旧循环自行退出 */
    let token = 0
    let session = null // 当前 screenrecord 进程
    let recordStyle = 'eq'
    let recordFails = 0
    let dropNoticed = false

    const send = (obj) => {
      if (!closed && ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj))
    }

    const sendFrame = (pngFrame, meta) => {
      if (closed || ws.readyState !== ws.OPEN) return
      const metaBuf = Buffer.from(JSON.stringify(meta), 'utf8')
      const header = Buffer.alloc(4)
      header.writeUInt32BE(metaBuf.length, 0)
      ws.send(Buffer.concat([header, metaBuf, pngFrame]), { binary: true })
    }

    /** 录屏帧：4 字节头写 0（无 meta），后面全是 H.264 裸流 —— 前端据此走 WebCodecs 解码 */
    const sendVideo = (chunk) => {
      if (closed || ws.readyState !== ws.OPEN) return
      if (ws.bufferedAmount > 8 * 1024 * 1024) {
        if (!dropNoticed) {
          dropNoticed = true
          send({ type: 'record', state: 'warn', message: '前端接收过慢，已丢弃部分录屏数据' })
        }
        return
      }
      const header = Buffer.alloc(4)
      ws.send(Buffer.concat([header, chunk]), { binary: true })
    }

    /** 切换画面管道：旧的抓屏循环 / 录屏进程会因 token 变化自动收尾 */
    function restartPipeline() {
      token += 1
      if (session) {
        session.kill()
        session = null
      }
      const my = token
      if (cfg.mode === 'record' && serial !== DEMO_SERIAL) runRecordLoop(my)
      else runCaptureLoop(my)
    }

    /* ------------------------- 画面来源 1：逐帧截图（screencap） ------------------------- */
    async function runCaptureLoop(my) {
      let lastFrameAt = 0
      let smoothedFps = 0
      let failCount = 0

      while (!closed && my === token) {
        if (cfg.paused) {
          await sleep(150)
          continue
        }
        const t0 = Date.now()
        try {
          const png =
            serial === DEMO_SERIAL ? await getPng(serial, { maxAge: 0, force: true }) : await engine.current().screenshot(serial)
          if (closed || my !== token) break
          const frameId = storeFrame(serial, png)
          // 同步刷新缓存，使「取色 / 找色」在帧被淘汰时可秒回
          pngCache.set(serial, { at: Date.now(), promise: Promise.resolve(png) })
          const frame = await encodeFrame(png, { scale: cfg.scale, compressionLevel: cfg.compressionLevel })
          if (closed || my !== token) break
          failCount = 0
          const now = Date.now()
          if (lastFrameAt) {
            const inst = 1000 / Math.max(1, now - lastFrameAt)
            smoothedFps = smoothedFps ? smoothedFps * 0.7 + inst * 0.3 : inst
          }
          lastFrameAt = now
          sendFrame(frame.buffer, {
            serial,
            frameId,
            width: frame.width,
            height: frame.height,
            deviceWidth: frame.deviceWidth,
            deviceHeight: frame.deviceHeight,
            scale: frame.scale,
            format: 'png',
            mode: 'screencap',
            ts: now,
            cost: now - t0,
            fps: Number(smoothedFps.toFixed(1)),
          })
        } catch (err) {
          failCount += 1
          // 抓屏失败可能是设备掉了，也可能只是一次抖动（大屏截屏偶发坏帧）。
          // 用 adb devices 实探一下，别让前端把画面误冻结。
          let deviceGone = false
          if (serial !== DEMO_SERIAL) {
            try {
              const list = await engine.current().devices()
              deviceGone = !list.some((d) => d.serial === serial && d.state === 'device')
            } catch {}
          }
          send({
            type: 'error',
            message: err.message || String(err),
            serial,
            failCount,
            deviceGone,
          })
          await sleep(deviceGone ? 1500 : 800)
          continue
        }
        const interval = 1000 / cfg.fps
        const elapsed = Date.now() - t0
        await sleep(Math.max(40, interval - elapsed))
      }
    }

    /* ------------------------- 画面来源 2：屏幕录制（screenrecord） ------------------------- */
    async function runRecordLoop(my) {
      // 先量一次「当前旋转下的真实画面尺寸」：wm size 给的是面板物理尺寸，横屏时不换向，
      // 直接拿它算 --size 会把画面压扁。截图拿到的尺寸才是设备正在输出的画面。
      let display = null
      try {
        display = await readSize(await getPng(serial, { force: true }))
      } catch {}
      if (closed || my !== token) return

      const deviceWidth = display?.width || 0
      const deviceHeight = display?.height || 0
      send({
        type: 'record',
        state: 'starting',
        serial,
        bitrate: cfg.bitrate,
        deviceWidth,
        deviceHeight,
      })

      while (!closed && my === token) {
        const size = fitRecordSize(display, cfg.scale)
        const startedAt = Date.now()
        let bytes = 0
        let stderr = ''
        let killed = false
        let announced = false

        let child
        try {
          child = engine.current().record(serial, { bitrate: cfg.bitrate, size, style: recordStyle })
        } catch (err) {
          send({ type: 'record', state: 'fatal', message: `无法启动 adb：${err.message}` })
          return
        }

        session = {
          kill() {
            killed = true
            try {
              child.kill()
            } catch {}
          },
        }

        const done = new Promise((resolve) => {
          child.on('error', (err) => resolve({ code: -1, stderr: err.message || String(err) }))
          child.on('close', (code) => resolve({ code, stderr }))
        })

        child.stdout.on('data', (buf) => {
          if (closed || my !== token) return
          bytes += buf.length
          if (!announced) {
            announced = true
            // 每一段录屏都从一个关键帧开始，通知前端重建解码器
            send({
              type: 'record',
              state: 'stream',
              width: size?.width || deviceWidth,
              height: size?.height || deviceHeight,
              deviceWidth,
              deviceHeight,
              bitrate: cfg.bitrate,
            })
          }
          sendVideo(buf)
        })
        child.stderr.on('data', (buf) => {
          stderr = (stderr + buf.toString('utf8')).slice(-1500)
        })

        const res = await done
        const errText = (res.stderr || stderr || '').trim()
        session = null
        if (closed || my !== token) return

        const lived = Date.now() - startedAt
        if (bytes > 0) recordFails = 0
        if (bytes > 0) dropNoticed = false

        if (killed) {
          // 参数变更 / 前端要求重建：直接续录
          send({ type: 'record', state: 'restart', message: '画面参数已更新，重新开始录屏' })
          continue
        }
        // 正常到点结束（--time-limit 上限 180s）：无缝续录
        if (bytes > 0 && res.code === 0) {
          send({ type: 'record', state: 'restart' })
          await sleep(120)
          continue
        }
        // 跑了一阵才挂：当成抖动，重开一次
        if (bytes > 0 && lived >= 5000) {
          send({ type: 'record', state: 'restart' })
          await sleep(300)
          continue
        }

        recordFails += 1
        // 老版本 screenrecord 只认 --key value 写法，换个写法再试一次
        if (bytes === 0 && recordFails <= 2 && looksLikeArgError(errText)) {
          recordStyle = recordStyle === 'eq' ? 'two' : 'eq'
          continue
        }

        let deviceGone = false
        try {
          const list = await engine.current().devices()
          deviceGone = !list.some((d) => d.serial === serial && d.state === 'device')
        } catch {}

        const message = errText || `screenrecord 退出（code ${res.code}）`
        send({ type: 'record', state: 'error', message, deviceGone, bitrate: cfg.bitrate })

        if (deviceGone) {
          await sleep(1500)
          continue
        }
        if (recordFails >= 3) {
          send({ type: 'record', state: 'fatal', message })
          return
        }
        await sleep(Math.min(2500, 500 * recordFails))
      }
    }

    ws.on('message', (raw) => {
      let msg
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return
      }
      if (msg.type === 'config') {
        const prevMode = cfg.mode
        const prevScale = cfg.scale
        const prevBitrate = cfg.bitrate
        const prevSerial = serial
        if (Number.isFinite(msg.fps)) cfg.fps = Math.max(0.5, Math.min(15, msg.fps))
        if (Number.isFinite(msg.scale)) cfg.scale = Math.max(1, Math.min(6, Math.round(msg.scale)))
        if (Number.isFinite(msg.level)) cfg.compressionLevel = Math.max(0, Math.min(9, Math.round(msg.level)))
        if (msg.bitrate !== undefined) cfg.bitrate = clampBitrate(msg.bitrate)
        if (msg.mode === 'record' || msg.mode === 'screencap') cfg.mode = msg.mode
        if (msg.serial && msg.serial !== serial) {
          serial = msg.serial
          pngCache.delete(serial)
        }
        send({ type: 'config', ...cfg, serial })
        const dirty =
          prevMode !== cfg.mode ||
          prevSerial !== serial ||
          (cfg.mode === 'record' && (prevScale !== cfg.scale || prevBitrate !== cfg.bitrate))
        if (dirty) restartPipeline()
        return
      }
      if (msg.type === 'pause') {
        cfg.paused = true
        send({ type: 'config', ...cfg, serial })
        return
      }
      if (msg.type === 'resume') {
        cfg.paused = false
        send({ type: 'config', ...cfg, serial })
        return
      }
      if (msg.type === 'snapshot') {
        pngCache.delete(serial)
        return
      }
      // 远程触控：down / move / up 直接写进同一个 adb shell，设备看到的是连续手势
      if (msg.type === 'touch') {
        if (serial === DEMO_SERIAL || !msg.phase) return
        const r = touchEvent(serial, { phase: msg.phase, x: msg.x, y: msg.y })
        // 拖动时事件很密，出错了只提示一次，免得刷屏
        if (!r.ok && Date.now() - touchErrorAt > 5000) {
          touchErrorAt = Date.now()
          send({ type: 'error', message: `触控失败：${r.error}`, serial })
        }
        return
      }
      // 前端解码器出错时要求重建：杀掉当前录屏进程，下一段从关键帧重新开始
      if (msg.type === 'record-restart') {
        if (cfg.mode === 'record' && serial !== DEMO_SERIAL) restartPipeline()
      }
    })

    ws.on('close', () => {
      closed = true
      token += 1
      if (session) {
        session.kill()
        session = null
      }
      releaseTouch(serial)
    })
    ws.on('error', () => {
      closed = true
      token += 1
      if (session) {
        session.kill()
        session = null
      }
      releaseTouch(serial)
    })

    send({ type: 'ready', serial, ...cfg })
    restartPipeline()
  })

  return wss
}

/* ------------------------------ 插件导出 ------------------------------ */
export function adbHelperPlugin() {
  let attached = false

  return {
    name: 'autojs6-adb-helper',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/')) return next()
        const url = new URL(req.url, 'http://127.0.0.1')
        const t0 = Date.now()
        let logged = false
        const done = () => {
          if (logged || process.env.ADB_HELPER_LOG === '0') return
          logged = true
          server.config.logger.info(
            `  [adb-helper] ${req.method} ${url.pathname}${url.search.slice(0, 80)} ` +
              `→ ${res.statusCode} ${Date.now() - t0}ms`,
          )
        }
        res.once('finish', done)
        res.once('close', done)
        try {
          await handleApi(req, res, url)
        } catch (err) {
          server.config.logger.error(`  [adb-helper] ${url.pathname} 失败：${err.message}`)
          if (!res.headersSent) sendJson(res, { ok: false, error: err.message || String(err) }, 500)
          else res.end()
        }
      })

      const attach = () => {
        if (attached || !server.httpServer) return
        attached = true
        // 避免 keep-alive 空闲连接被 Node 提前回收后，浏览器复用失效 socket 导致请求失败
        server.httpServer.keepAliveTimeout = 120000
        server.httpServer.headersTimeout = 125000
        attachWebSocket(server.httpServer)
        // 退出时收掉触摸 shell，别在设备上留一个按住不放的手指；
        // 同时释放 USB 接口 —— 句柄不放，下次启动 claim 就是 error 5
        process.once('exit', () => {
          closeAllTouches()
          restoreStayAwake().catch(() => {})
          engine.dispose()
        })
        server.httpServer.on('close', () => {
          closeAllTouches()
          restoreStayAwake().catch(() => {})
          engine.dispose()
        })
        server.config.logger.info('\n  \x1b[36m➜\x1b[0m  ADB 辅助服务已就绪：/api/*  ·  /ws/screen\n')
      }
      if (server.httpServer) attach()
      else server.httpServer?.once?.('listening', attach)
      server.httpServer?.on('listening', attach)
    },
  }
}

export { DEMO_SERIAL }
