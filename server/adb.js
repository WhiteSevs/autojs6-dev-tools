import { spawn } from 'node:child_process'
import path from 'node:path'

const ADB_BIN = process.env.ADB_PATH || 'adb'

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

/** 解析 `adb devices -l` */
export async function listDevices() {
  const r = await runAdb(['devices', '-l'], { timeout: 15000 })
  if (r.code !== 0) throw new Error(r.stderr.trim() || 'adb devices 执行失败')
  const devices = []
  for (const raw of r.text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('List of devices') || line.startsWith('*')) continue
    const [serial, state, ...rest] = line.split(/\s+/)
    if (!serial) continue
    const meta = {}
    for (const token of rest) {
      const idx = token.indexOf(':')
      if (idx > 0) meta[token.slice(0, idx)] = token.slice(idx + 1)
    }
    devices.push({
      serial,
      state,
      model: meta.model || '',
      product: meta.product || '',
      device: meta.device || '',
      transportId: meta.transport_id || '',
      kind: /:\d+$/.test(serial) ? 'network' : 'usb',
    })
  }
  return devices
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

const infoCache = new Map()

export async function getDeviceInfo(serial, { force = false } = {}) {
  if (!force && infoCache.has(serial)) {
    const cached = infoCache.get(serial)
    if (Date.now() - cached.ts < 15000) return cached.data
  }
  const cmd = [
    'wm size',
    'wm density',
    'getprop ro.product.model',
    'getprop ro.product.brand',
    'getprop ro.build.version.release',
    'getprop ro.build.version.sdk',
    'getprop ro.sf.lcd_density',
  ].join('; ')

  const r = await runAdb(['-s', serial, 'shell', cmd], { timeout: 15000 })
  const text = r.text || ''

  let physical = null
  let override = null
  const sizeMatches = [...text.matchAll(/(Physical|Override) size:\s*(\d+)x(\d+)/g)]
  for (const m of sizeMatches) {
    const value = { width: Number(m[2]), height: Number(m[3]) }
    if (m[1] === 'Physical') physical = value
    else override = value
  }
  const densityMatch = text.match(/Physical density:\s*(\d+)/)
  const lines = text.split('\n').map((s) => s.trim()).filter(Boolean)
  const props = lines.filter((l) => !/size:|density:/i.test(l))

  const data = {
    serial,
    model: props[0] || '',
    brand: props[1] || '',
    androidVersion: props[2] || '',
    sdk: props[3] || '',
    screen: override || physical || { width: 0, height: 0 },
    physical,
    override,
    density: densityMatch ? Number(densityMatch[1]) : Number(props[4]) || 0,
  }
  infoCache.set(serial, { ts: Date.now(), data })
  return data
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

const KEY_CODES = { back: 4, home: 3, recents: 187, power: 26, volume_up: 24, volume_down: 25, enter: 66 }

export async function shellKey(serial, key) {
  const code = KEY_CODES[key] ?? Number(key)
  if (!Number.isFinite(code)) throw new Error(`未知按键：${key}`)
  const r = await runAdb(['-s', serial, 'shell', 'input', 'keyevent', String(code)], { timeout: 12000 })
  return { ok: r.code === 0, message: r.stderr.trim() }
}

export const adbBinName = path.basename(ADB_BIN)
