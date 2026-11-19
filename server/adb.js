import { spawn } from 'node:child_process'
import path from 'node:path'
import { INFO_SHELL_CMD, getCachedInfo, parseDeviceInfo, setCachedInfo } from './device-info.js'

export const ADB_BIN = process.env.ADB_PATH || 'adb'

/** 执行 adb 命令，二进制安全（不经过 shell，stdout 以 Buffer 返回） */
export function runAdb(args, { timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(ADB_BIN, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      })
    } catch (err) {
      reject(Object.assign(new Error(`无法启动 adb：${err.message}`), { code: 'ADB_NOT_FOUND' }))
      return
    }

    const out = []
    const errChunks = []
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { child.kill() } catch {}
      reject(new Error(`adb 命令超时（${timeout}ms）：adb ${args.join(' ')}`))
    }, timeout)

    child.stdout.on('data', (c) => out.push(c))
    child.stderr.on('data', (c) => errChunks.push(c))

    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (err.code === 'ENOENT') {
        reject(
          Object.assign(
            new Error('未找到 adb 可执行文件。请安装 Android Platform Tools 并加入 PATH，或设置环境变量 ADB_PATH。'),
            { code: 'ADB_NOT_FOUND' },
          ),
        )
      } else {
        reject(err)
      }
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const stdout = Buffer.concat(out)
      const stderr = Buffer.concat(errChunks).toString('utf8')
      resolve({ code, stdout, stderr, text: stdout.toString('utf8').replace(/\r\n/g, '\n') })
    })
  })
}

export async function getAdbVersion() {
  try {
    const r = await runAdb(['version'], { timeout: 8000 })
    const line = r.text.split('\n')[0]?.trim() || ''
    return { ok: r.code === 0, adbPath: ADB_BIN, version: line, error: r.code === 0 ? null : r.stderr.trim() }
  } catch (err) {
    return { ok: false, adbPath: ADB_BIN, version: '', error: err.message }
  }
}

/** `adb devices` 里可能出现的设备状态（按词长优先排，避免被前缀词误判） */
const DEVICE_STATES = [
  'no permissions',
  'unauthorized',
  'connecting',
  'authorizing',
  'bootloader',
  'recovery',
  'sideload',
  'offline',
  'rescue',
  'device',
  'host',
]
const DEVICE_LINE_RE = new RegExp(`^(.+?)\\s+(${DEVICE_STATES.join('|')})(?=\\s|$)\\s*(.*)$`)

/** 解析 `adb devices -l` */
export async function listDevices() {
  const r = await runAdb(['devices', '-l'], { timeout: 15000 })
  if (r.code !== 0) throw new Error(r.stderr.trim() || 'adb devices 执行失败')
  const devices = []
  for (const raw of r.text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('List of devices') || line.startsWith('*')) continue
    // 序列号本身可能含空格：mDNS 设备名重复时 adb 会给出 "adb-xxx-yyy (2)._adb-tls-connect._tcp"，
    // 直接按空白切分会把状态读成那段后缀。改为按「已知状态词」定位分隔点。
    const m = line.match(DEVICE_LINE_RE)
    if (!m) continue
    const serial = m[1].trim()
    const state = m[2]
    const rest = m[3] || ''
    const meta = {}
    if (state !== 'no permissions') {
      for (const token of rest.trim().split(/\s+/)) {
        const idx = token.indexOf(':')
        if (idx > 0) meta[token.slice(0, idx)] = token.slice(idx + 1)
      }
    }
    // 新版 adb 会把自己通过 mDNS 发现的设备也列出来，序列号形如 adb-xxx-yyy._adb-tls-connect._tcp
    const mdnsMatch = serial.match(/^(.*?)_adb-tls-(?:connect|pairing)\._tcp\.?$/i)
    devices.push({
      serial,
      state,
      model: meta.model || '',
      product: meta.product || '',
      device: meta.device || '',
      transportId: meta.transport_id || '',
      kind: mdnsMatch ? 'mdns' : /:\d+$/.test(serial) ? 'network' : 'usb',
      // mDNS 设备名 = 去掉服务类型与重名后缀后的实例名
      mdnsName: mdnsMatch
        ? mdnsMatch[1]
            .replace(/\.$/, '')
            .replace(/\s*\(\d+\)$/, '')
            .trim()
        : '',
    })
  }
  return devices
}

/* ------------------------------ mDNS 局域网发现 ------------------------------ */
/**
 * mDNS 发现（Android 11+ 无线调试）依赖平台的 adb 是否编译了 mdns 支持：
 * 老 adb 没有 `mdns` 子命令，部分 Windows 版本会直接回 unsupported / disabled。
 * 所以这里不猜版本号，直接以 `adb mdns check` 的真实输出为准，并把结果缓存一会儿，
 * 免得每次刷新设备列表都多起一个进程。
 */
let mdnsProbe = null

export async function mdnsCheck({ force = false } = {}) {
  if (!force && mdnsProbe && Date.now() - mdnsProbe.at < 60_000) return mdnsProbe.result
  let result
  try {
    const r = await runAdb(['mdns', 'check'], { timeout: 8000 })
    const text = `${r.text}\n${r.stderr}`.trim()
    const yes = /mdns daemon version/i.test(text)
    const unsupported = /not supported|unknown command|unrecognized|usage: adb mdns/i.test(text)
    result = {
      ok: yes,
      supported: yes,
      enabled: yes,
      reason: yes ? '' : unsupported ? 'unsupported' : 'disabled',
      message: text.split('\n').map((s) => s.trim()).filter(Boolean)[0] || '',
    }
  } catch (err) {
    result = {
      ok: false,
      supported: false,
      enabled: false,
      reason: /未知|unknown|timeout|超时/i.test(err.message) ? 'unsupported' : 'error',
      message: err.message,
    }
  }
  mdnsProbe = { at: Date.now(), result }
  return result
}

/** 设备 id：`adb-78ac2eb7-u8tR1e` → `adb-78ac2eb7`，用来把配对服务与连接服务对到同一台机器上 */
function mdnsDeviceKey(name) {
  const m = String(name).match(/^(adb-[0-9a-z]+)/i)
  return m ? m[1].toLowerCase() : String(name).toLowerCase()
}

/**
 * 解析 `adb mdns services`，输出：
 *   adb-78ac2eb7-u8tR1e (2)	_adb-tls-connect._tcp	172.19.58.153:45387
 * 同一台设备可能同时有多个端口记录（旧记录要等 TTL 过期），按设备名聚合后前端依次尝试。
 */
export async function mdnsServices({ force = false } = {}) {
  const probe = await mdnsCheck({ force })
  if (!probe.ok) return { ...probe, services: [], raw: '' }

  const r = await runAdb(['mdns', 'services'], { timeout: 12000 })
  const text = `${r.text}\n${r.stderr}`.trim()
  const services = []
  for (const raw of r.text.split('\n')) {
    const line = raw.trim()
    if (!line || /^List of discovered/i.test(line) || line.startsWith('*')) continue
    const [name, serviceType, addr] = line.split(/\s+/)
    if (!name || !serviceType || !addr) continue
    const m = addr.match(/^(.+):(\d+)$/)
    if (!m) continue
    const port = Number(m[2])
    if (!Number.isFinite(port)) continue
    const kind = /pairing/i.test(serviceType) ? 'pairing' : /connect/i.test(serviceType) ? 'connect' : 'other'
    services.push({
      // 去掉 mDNS 给重名记录加的 " (2)" 后缀，同一个 key 视为同一台设备的同一个服务
      name: name.replace(/\s*\(\d+\)$/, ''),
      displayName: name,
      deviceKey: mdnsDeviceKey(name),
      serviceType,
      host: m[1],
      port,
      address: `${m[1]}:${port}`,
      kind,
    })
  }
  return { ...probe, services, raw: text }
}

/** 无线调试配对：`adb pair <ip:port> <6 位配对码>`（配对码来自设备屏幕） */
export async function adbPair(address, code) {
  const r = await runAdb(['pair', address, String(code)], { timeout: 30000 })
  const text = `${r.text}\n${r.stderr}`.trim()
  return { ok: /Successfully paired/i.test(text), message: text }
}

export async function adbConnect(address) {
  const r = await runAdb(['connect', address], { timeout: 20000 })
  const text = (r.text + r.stderr).trim()
  const ok = /connected to/i.test(text) && !/cannot|failed|unable/i.test(text)
  return { ok, message: text }
}

export async function adbDisconnect(address) {
  const r = await runAdb(['disconnect', address], { timeout: 15000 })
  return { ok: true, message: (r.text + r.stderr).trim() }
}

/** 抓取一帧 PNG（exec-out 二进制安全，不受 Windows CRLF 影响） */
export async function capturePng(serial) {
  const r = await runAdb(['-s', serial, 'exec-out', 'screencap', '-p'], { timeout: 25000 })
  if (r.code !== 0) throw new Error(`截屏失败：${r.stderr.trim() || 'adb 返回非 0'}`)
  const buf = r.stdout
  const signature = buf.subarray(0, 8).toString('hex')
  if (signature !== '89504e470d0a1a0a') {
    const head = buf.subarray(0, 120).toString('utf8').trim()
    throw new Error(`截屏数据不是合法 PNG（可能设备未授权或锁屏）：${head.slice(0, 100) || signature}`)
  }
  return buf
}

export async function getDeviceInfo(serial, { force = false } = {}) {
  if (!force) {
    const cached = getCachedInfo(serial)
    if (cached) return cached
  }
  const r = await runAdb(['-s', serial, 'shell', INFO_SHELL_CMD], { timeout: 15000 })
  return setCachedInfo(serial, parseDeviceInfo(serial, r.text))
}

export async function shellTap(serial, x, y) {
  const r = await runAdb(['-s', serial, 'shell', 'input', 'tap', String(x), String(y)], { timeout: 12000 })
  return { ok: r.code === 0, message: r.stderr.trim() }
}

export async function shellSwipe(serial, { x1, y1, x2, y2, duration = 300 }) {
  const r = await runAdb(
    ['-s', serial, 'shell', 'input', 'swipe', String(x1), String(y1), String(x2), String(y2), String(duration)],
    { timeout: 15000 },
  )
  return { ok: r.code === 0, message: r.stderr.trim() }
}

/**
 * 长按拖拽：`input draganddrop` 会先按住（超过长按阈值）再移动，系统才会把后续移动当成拖拽，
 * 普通 swipe 的移动从按下就开始，长按计时会被打断，所以拖放 / 排序必须用这个。
 * 老系统没有 draganddrop 时退回 motionevent 组合（DOWN → 等待 → MOVE → UP）。
 */
export async function shellDragAndDrop(serial, { x1, y1, x2, y2, duration = 800 }) {
  const r = await runAdb(
    ['-s', serial, 'shell', 'input', 'draganddrop', String(x1), String(y1), String(x2), String(y2), String(duration)],
    { timeout: 20000 },
  )
  if (r.code === 0) return { ok: true, message: r.stderr.trim() }

  const fallback = await runAdb(
    [
      '-s',
      serial,
      'shell',
      `input motionevent DOWN ${x1} ${y1};`,
      'sleep',
      '0.7;',
      `input motionevent MOVE ${x2} ${y2};`,
      `input motionevent UP ${x2} ${y2}`,
    ],
    { timeout: 20000 },
  )
  return {
    ok: fallback.code === 0,
    message: fallback.code === 0 ? 'drag（motionevent 回退）' : fallback.stderr.trim() || r.stderr.trim(),
  }
}

export const KEY_CODES = {
  back: 4,
  home: 3,
  recents: 187,
  power: 26,
  volume_up: 24,
  volume_down: 25,
  volume_mute: 164,
  enter: 66,
  // 实时点击的键盘映射用到的三个：退格 / 向后删除 / 空格
  // （KEYCODE_DEL=67 是退格，KEYCODE_FORWARD_DEL=112 才是 Delete 键，别弄反）
  delete: 67,
  forward_del: 112,
  space: 62,
}

/**
 * 开一条常驻 shell 通道（远程触控用）。
 * 调用方拿到的是 ChildProcess，stdin / stdout / stderr / kill / close
 * 与 `spawn(adb …)` 完全一致 —— 这样换连接引擎时上层逻辑不用改。
 */
export function openShell(serial) {
  return spawn(ADB_BIN, ['-s', serial, 'shell'], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
  })
}

export async function shellKey(serial, key) {
  const code = KEY_CODES[key] ?? Number(key)
  if (!Number.isFinite(code)) throw new Error(`未知按键：${key}`)
  const r = await runAdb(['-s', serial, 'shell', 'input', 'keyevent', String(code)], { timeout: 12000 })
  return { ok: r.code === 0, message: r.stderr.trim() }
}

export const adbBinName = path.basename(ADB_BIN)
