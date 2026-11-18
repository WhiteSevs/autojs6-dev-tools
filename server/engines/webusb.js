/**
 * 连接引擎：USB 直连（WebUSB）
 *
 * 用 `usb` 包提供的 WebUSB 实现 + Tango（@yume-chan/adb）直接和手机上的 adbd 说 ADB 协议，
 * 不再需要 adb 可执行文件。代价是 USB 接口独占：adb server / Android Studio 占着的时候抢不到，
 * 必须先 `adb kill-server`。
 *
 * 依赖是可选的 —— 没装 / 加载失败时这里全部降级成「不可用 + 原因」，不影响 ADB 引擎照常工作。
 */
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { generateKeyPairSync } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { INFO_SHELL_CMD, getCachedInfo, parseDeviceInfo, setCachedInfo } from '../device-info.js'
import { KEY_CODES } from '../adb.js'
import { buildScreenRecordArgs } from '../record.js'

export const id = 'webusb'
export const label = 'USB 直连'
export const short = 'WebUSB'
export const desc = '内置 ADB 协议栈直接走 USB，不需要安装 platform-tools；与 adb 命令互斥占用设备'
export const capabilities = { usb: true, wireless: false, mdns: false }

/* ------------------------------ 依赖懒加载 ------------------------------ */
/** 依赖是可选的：加载失败只记住原因，不抛到模块顶层，否则整个 dev server 都起不来 */
let modsPromise = null

function loadMods() {
  if (!modsPromise) {
    modsPromise = (async () => {
      const [core, webusb, usbPkg] = await Promise.all([
        import('@yume-chan/adb'),
        import('@yume-chan/adb-daemon-webusb'),
        import('usb'),
      ])
      return { core, webusb, usb: usbPkg }
    })().catch((err) => {
      modsPromise = null
      throw new Error(`USB 直连依赖不可用：${err.message}（需要安装 usb、@yume-chan/adb、@yume-chan/adb-daemon-webusb）`)
    })
  }
  return modsPromise
}

/* ------------------------------ 凭据（ADB 私钥） ------------------------------ */
/**
 * 和 adb 共用 ~/.android/adbkey：
 * 用户之前用 adb 授权过，这里就不用再在手机上点一次「允许 USB 调试」。
 */
const KEY_DIR = path.join(os.homedir(), '.android')
const PRIVATE_KEY = path.join(KEY_DIR, 'adbkey')
const PUBLIC_KEY = path.join(KEY_DIR, 'adbkey.pub')

function keyName() {
  try {
    return `${os.userInfo().username}@${os.hostname()}`
  } catch {
    return 'usb-webusb'
  }
}

function pemToDer(pem) {
  const body = String(pem)
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '')
  if (!body) throw new Error('adbkey 内容为空')
  return new Uint8Array(Buffer.from(body, 'base64'))
}

function derToPem(der) {
  const b64 = Buffer.from(der).toString('base64').replace(/(.{64})/g, '$1\n').replace(/\n$/, '')
  return `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`
}

let credentialStore = null

function getCredentialStore() {
  if (credentialStore) return credentialStore
  credentialStore = {
    async generateKey() {
      const { adbGeneratePublicKey } = await loadMods().then((m) => m.core)
      const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: 0x10001 })
      const der = new Uint8Array(privateKey.export({ type: 'pkcs8', format: 'der' }))
      const name = keyName()
      await mkdir(KEY_DIR, { recursive: true })
      await writeFile(PRIVATE_KEY, derToPem(der), { mode: 0o600 })
      await writeFile(
        PUBLIC_KEY,
        `${Buffer.from(adbGeneratePublicKey(der)).toString('base64')} ${name}\n`,
        'utf8',
      )
      return { buffer: der, name }
    },
    async *iterateKeys() {
      if (!fs.existsSync(PRIVATE_KEY)) return
      try {
        const der = pemToDer(await readFile(PRIVATE_KEY, 'utf8'))
        let name = keyName()
        try {
          const pub = await readFile(PUBLIC_KEY, 'utf8')
          const after = pub.trim().split(/\s+/)[1]
          if (after) name = after
        } catch {}
        yield { buffer: der, name }
      } catch {
        // 文件损坏就当没有，交给 generateKey 重新生成
      }
    },
  }
  return credentialStore
}

/* ------------------------------ 设备枚举 ------------------------------ */
const ADB_INTERFACE = { classCode: 0xff, subclassCode: 0x42, protocolCode: 1 }

function safeRead(fn, fallback = null) {
  try {
    return fn()
  } catch {
    return fallback
  }
}

/**
 * 找设备的 ADB 接口。
 * 注意 `device.configurations` 是会抛异常的 —— 有些设备（摄像头之类）读不到字符串描述符，
 * usb 包会直接抛 getString error，所以整个遍历必须包在 try 里，坏一个不能拖垮整张列表。
 */
function findAdbInterface(raw) {
  const configs = safeRead(() => raw.configurations, null)
  if (!configs) return null
  for (const configuration of configs) {
    for (const interface_ of configuration.interfaces || []) {
      for (const alternate of interface_.alternates || []) {
        if (
          alternate.interfaceClass === ADB_INTERFACE.classCode &&
          alternate.interfaceSubclass === ADB_INTERFACE.subclassCode &&
          alternate.interfaceProtocol === ADB_INTERFACE.protocolCode
        ) {
          return { configuration, interface_, alternate }
        }
      }
    }
  }
  return null
}

function fallbackSerial(raw) {
  const hex = (v) => String(v ?? 0).padStart(4, '0')
  return `${hex(raw.vendorId)}x${hex(raw.productId)}`
}

/** 列出所有带 ADB 接口的 USB 设备（不 claim 接口，所以不会和 adb 打架） */
async function listCandidates() {
  const { usb } = await loadMods()
  const raws = await usb.usb.getDevices()
  const list = []
  for (const raw of raws) {
    const iface = findAdbInterface(raw)
    if (!iface) continue
    list.push({
      raw,
      iface,
      serial: safeRead(() => raw.serialNumber, '') || fallbackSerial(raw),
      product: safeRead(() => raw.productName, '') || '',
    })
  }
  return list
}

export async function devices() {
  const candidates = await listCandidates()
  return candidates.map(({ serial, product }) => ({
    serial,
    state: 'device',
    kind: 'usb',
    model: product,
    product,
    device: '',
    transportId: '',
    mdnsName: '',
    label: product ? `${product} (${serial})` : serial,
    ready: true,
  }))
}

/* ------------------------------ 连接管理 ------------------------------ */
/**
 * serial -> { adb, promise }；断线 / 出错时自动摘掉，下次重新认证。
 *
 * 放在 globalThis 上而不是模块作用域：Vite 改代码会重新加载本模块，
 * 模块级变量会连同旧连接一起被丢掉，但 OS 层的 USB 句柄还在握着设备 ——
 * 新模块再去 claim 就是 `failed to open device (error 5)`，只能重启进程才好。
 * 挂到 global 之后热重启会直接复用同一条连接。
 */
const CONNECTIONS_KEY = Symbol.for('autojs6.webusb.connections')
const connections = (globalThis[CONNECTIONS_KEY] ||= new Map())

function explain(err) {
  const raw = String(err?.message || err || '')
  const name = String(err?.name || '')
  if (
    /DeviceBusy|NetworkError|busy|LIBUSB_ERROR_BUSY|failed to open device|claimInterface|access denied/i.test(
      `${name} ${raw}`,
    )
  ) {
    return new Error(
      'USB 接口被占用：adb server / Android Studio / scrcpy 可能正拿着这台设备。先执行 `adb kill-server`（或切到「ADB 命令」再切回来）后重试',
    )
  }
  if (/NOT_SUPPORTED|WinUSB|libusb|not supported/i.test(raw)) {
    return new Error(
      '无法打开 USB 设备：这台机器的 ADB 接口可能没有绑定 WinUSB 驱动。安装 Google USB Driver（或厂商驱动）后重新插拔；最后手段可用 Zadig 换驱动',
    )
  }
  if (/auth|authenticat|unauthorized/i.test(raw)) {
    return new Error('ADB 认证未通过：看手机屏幕，允许这台电脑的 USB 调试（勾选「一律允许」可免每次确认）')
  }
  if (/no such device|cannot find|not found|No device/i.test(raw)) {
    return new Error('找不到这台 USB 设备，可能已被拔出或换了接口')
  }
  return new Error(raw || 'USB 连接失败')
}

async function openConnection(serial) {
  const { core, webusb, usb } = await loadMods()
  const candidates = await listCandidates()
  const hit = candidates.find((c) => c.serial === serial)
  if (!hit) throw new Error(`未找到 USB 设备 ${serial}（确认已插好、已开启 USB 调试）`)

  const device = new webusb.AdbDaemonWebUsbDevice(hit.raw, hit.iface, usb.usb)
  let connection
  try {
    connection = await device.connect()
  } catch (err) {
    throw explain(err)
  }

  let transport
  try {
    transport = await core.AdbDaemonTransport.authenticate({
      serial,
      connection,
      credentialStore: getCredentialStore(),
    })
  } catch (err) {
    try {
      await connection.close?.()
    } catch {}
    throw explain(err)
  }

  const adb = new core.Adb(transport)
  transport.disconnected.then(
    () => {
      if (connections.get(serial)?.adb === adb) connections.delete(serial)
    },
    () => {
      if (connections.get(serial)?.adb === adb) connections.delete(serial)
    },
  )
  return adb
}

/** 取这台设备的连接，没有就建一条（并发调用共用同一个 Promise） */
function ensure(serial) {
  const cached = connections.get(serial)
  if (cached) return cached.promise
  const entry = { adb: null, promise: null }
  entry.promise = openConnection(serial).then(
    (adb) => {
      entry.adb = adb
      return adb
    },
    (err) => {
      if (connections.get(serial) === entry) connections.delete(serial)
      throw err
    },
  )
  connections.set(serial, entry)
  return entry.promise
}

/**
 * 切换引擎 / 设备消失时把连接丢掉，避免拿着已经失效的接口继续用。
 * 必须 await：`Adb.close()` 才会走到 USB 的 releaseInterface，
 * 不等它就去 claim 另一条通道，Windows 上直接 error 5。
 */
export async function forget(serial) {
  const keys = serial ? [serial] : [...connections.keys()]
  await Promise.all(
    keys.map(async (key) => {
      const entry = connections.get(key)
      connections.delete(key)
      try {
        await entry?.adb?.close?.()
      } catch {}
    }),
  )
}

/** 进程退出 / 服务关闭时一定要放掉 USB 接口，否则下次启动就是 error 5 */
export function dispose() {
  forget().catch(() => {})
}

export async function probe() {
  try {
    const candidates = await listCandidates()
    return {
      ok: true,
      detail: `已就绪 · 检测到 ${candidates.length} 台带 ADB 接口的 USB 设备`,
      error: '',
      hint: '',
    }
  } catch (err) {
    return { ok: false, detail: '', error: err.message, hint: '在项目里执行 npm install 装齐依赖' }
  }
}

/* ------------------------------ shell 执行 ------------------------------ */
function normalize(proc) {
  // shellProtocol 有独立的 stdout / stderr / exitCode；noneProtocol 只有一个混合的 output
  if (proc.stdout) {
    return { stdin: proc.stdin, stdout: proc.stdout, stderr: proc.stderr || null, exited: proc.exited, kill: () => proc.kill() }
  }
  return { stdin: proc.stdin, stdout: proc.output, stderr: null, exited: null, kill: () => proc.kill() }
}

/**
 * 等进程退出码。
 * shell,v2 的退出包不一定会送达 —— 命令被管道另一端的 SIGPIPE 打断时，adbd 可能直接关掉 socket。
 * stdout 已经结束了还无限等下去就是死锁，所以这里给个上限，超时就当作正常结束。
 */
function waitExit(proc, ms = 1200) {
  if (!proc?.exited) return Promise.resolve(0)
  return Promise.race([
    proc.exited.then((code) => (typeof code === 'number' ? code : 0)).catch(() => -1),
    new Promise((resolve) => setTimeout(() => resolve(0), ms)),
  ])
}

async function spawnProcess(serial, command) {
  const adb = await ensure(serial)
  const shell = adb.subprocess.shellProtocol
  const proc = shell ? await shell.spawn(command) : await adb.subprocess.noneProtocol.spawn(command)
  const normalized = normalize(proc)
  // Tango 在 socket 没收到 exit 包时会 reject `exited`（"Socket ended without exit message"）。
  // 这个 rejection 可能在别处 await 之前就发生，Node 22 会当成未处理异常直接结束进程，
  // 所以创建时立刻挂一个兜底 catch；后面要退出码的地方照常再 await/catch 一次。
  normalized.exited?.catch?.(() => {})
  return normalized
}

/** 跑一条命令并等它结束，返回 stdout 文本（stderr 混进来也没关系，解析时按行过滤） */
async function execText(serial, command, { timeout = 8000 } = {}) {
  const proc = await spawnProcess(serial, command)
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try {
        proc.kill?.()
      } catch {}
      reject(new Error(`命令超时（${timeout}ms）：${command}`))
    }, timeout)
  })
  try {
    return await Promise.race([
      (async () => {
        const chunks = []
        await pump(proc.stdout, {
          write(chunk) {
            chunks.push(chunk)
            return true
          },
        })
        const code = await waitExit(proc)
        return { text: Buffer.concat(chunks).toString('utf8'), code }
      })(),
      deadline,
    ])
  } finally {
    clearTimeout(timer)
  }
}

export async function info(serial, { force = false } = {}) {
  if (!force) {
    const cached = getCachedInfo(serial)
    if (cached) return cached
  }
  const { text } = await execText(serial, INFO_SHELL_CMD)
  return setCachedInfo(serial, parseDeviceInfo(serial, text))
}

/** 跑一条 shell 命令并等结果：锁屏 / 解锁这类需要看返回文本的场景用 */
export async function shellText(serial, command, options) {
  return execText(serial, command, options)
}

/* ------------------------------ 截屏 ------------------------------ */
const PNG_SIGNATURE = '89504e470d0a1a0a'

export async function screenshot(serial, { timeout = 25000 } = {}) {
  let timer
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`截屏超时（${timeout}ms）`)), timeout)
  })
  try {
    return await Promise.race([
      (async () => {
        const proc = await spawnProcess(serial, 'screencap -p')
        const chunks = []
        await pump(proc.stdout, {
          write(chunk) {
            chunks.push(chunk)
            return true
          },
        })
        const buf = Buffer.concat(chunks)
        const signature = buf.subarray(0, 8).toString('hex')
        if (signature !== PNG_SIGNATURE) {
          const head = buf.subarray(0, 120).toString('utf8').trim()
          throw new Error(`截屏数据不是合法 PNG（可能设备未授权或锁屏）：${head.slice(0, 100) || signature}`)
        }
        return buf
      })(),
      timeoutPromise,
    ])
  } finally {
    clearTimeout(timer)
  }
}

/* ------------------------------ 进程通道（ChildProcess 形状） ------------------------------ */
/**
 * 把一个 Web Stream 泵到 Node 的 PassThrough 上。
 * 消费端（index.js / touch.js）是按 ChildProcess 写的，这里保持同样的形状，切换引擎时上层不用改。
 */
async function pump(readable, target) {
  const reader = readable.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value && value.length) {
        if (!target.write(Buffer.from(value))) {
          await new Promise((resolve) => target.once('drain', resolve))
        }
      }
    }
  } catch {
    // 通道被主动关闭时的读取异常属于正常流程
  } finally {
    try {
      reader.releaseLock()
    } catch {}
  }
}

/**
 * 立刻返回一个 ChildProcess 形状的通道，内部异步连设备。
 * 这样 touch.js 那种同步建通道的逻辑不用改成 async。
 */
function createChannel(start) {
  const emitter = new EventEmitter()
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()

  let proc = null
  let writer = null
  let finished = false
  let killed = false
  let writeChain = Promise.resolve()
  const pending = []

  const channel = {
    stdin,
    stdout,
    stderr,
    get killed() {
      return killed
    },
    kill() {
      killed = true
      try {
        proc?.kill?.()
      } catch {}
      try {
        stdin.destroy()
      } catch {}
      finish(0)
    },
    on(event, fn) {
      emitter.on(event, fn)
      return channel
    },
    once(event, fn) {
      emitter.once(event, fn)
      return channel
    },
    off(event, fn) {
      emitter.off(event, fn)
      return channel
    },
  }

  function finish(code, error) {
    if (finished) return
    finished = true
    if (error) emitter.emit('error', error)
    stderr.end()
    stdout.end()
    emitter.emit('close', code ?? 0)
  }

  function flushWrites() {
    if (!writer) return
    while (pending.length) {
      const chunk = pending.shift()
      writeChain = writeChain
        .then(() => writer.write(chunk))
        .catch((err) => {
          finish(-1, err)
        })
    }
  }

  stdin.on('data', (chunk) => {
    pending.push(new Uint8Array(chunk))
    flushWrites()
  })
  stdin.on('end', () => {
    writeChain = writeChain.then(() => writer?.close()).catch(() => {})
  })

  start().then((p) => {
    if (finished) {
      try {
        p.kill?.()
      } catch {}
      return
    }
    proc = p
    writer = p.stdin.getWriter()
    flushWrites()
    if (p.stderr) pump(p.stderr, stderr)
    pump(p.stdout, stdout).then(async () => {
      // 录屏 / 触控都靠这条 close 推动状态机，不能卡在退出码上
      finish(await waitExit(p, 400))
    })
  }, (err) => finish(-1, err))

  return channel
}

/* ------------------------------ 对外接口 ------------------------------ */
/** 常驻 shell：远程触控的 down / move / up 都写在同一条通道里，设备看到的是连续手势 */
export function shell(serial) {
  return createChannel(() => spawnProcess(serial, 'sh'))
}

/** 录屏：H.264 裸流通过 stdout 推出去，语义和 `adb exec-out screenrecord … -` 一致 */
export function record(serial, options = {}) {
  const command = buildScreenRecordArgs(options).join(' ')
  return createChannel(() => spawnProcess(serial, command))
}

/* ------------------------------ 设备操作 ------------------------------ */
export async function tap(serial, x, y) {
  const { code, text } = await execText(serial, `input tap ${Math.round(x)} ${Math.round(y)}`)
  return { ok: code === 0, message: text.trim() }
}

export async function swipe(serial, { x1, y1, x2, y2, duration = 300 }) {
  const cmd = `input swipe ${Math.round(x1)} ${Math.round(y1)} ${Math.round(x2)} ${Math.round(y2)} ${Math.round(duration)}`
  const { code, text } = await execText(serial, cmd)
  return { ok: code === 0, message: text.trim() }
}

export async function dragDrop(serial, { x1, y1, x2, y2, duration = 800 }) {
  const main = `input draganddrop ${Math.round(x1)} ${Math.round(y1)} ${Math.round(x2)} ${Math.round(y2)} ${Math.round(duration)}`
  const first = await execText(serial, main)
  if (first.code === 0) return { ok: true, message: first.text.trim() }

  const fallback = [
    `input motionevent DOWN ${Math.round(x1)} ${Math.round(y1)};`,
    'sleep 0.7;',
    `input motionevent MOVE ${Math.round(x2)} ${Math.round(y2)};`,
    `input motionevent UP ${Math.round(x2)} ${Math.round(y2)}`,
  ].join(' ')
  const second = await execText(serial, fallback)
  return {
    ok: second.code === 0,
    message: second.code === 0 ? 'drag（motionevent 回退）' : second.text.trim() || first.text.trim(),
  }
}

export async function key(serial, name) {
  const code = KEY_CODES[name] ?? Number(name)
  if (!Number.isFinite(code)) throw new Error(`未知按键：${name}`)
  const { code: exitCode, text } = await execText(serial, `input keyevent ${code}`)
  return { ok: exitCode === 0, message: text.trim() }
}

/* 无线调试 / 配对 / mDNS 只有 adb 引擎有，上位调用前会先看 capabilities */
