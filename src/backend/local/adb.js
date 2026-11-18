/**
 * 浏览器端 ADB —— 用 WebUSB（navigator.usb）+ Tango（@yume-chan/adb）直接和手机上的 adbd 说协议。
 *
 * 和服务端那条 adb 命令行完全无关：不装 platform-tools、不起进程、不经 Node，
 * 整个协议栈跑在页面里，所以打包成静态站点也能连设备。
 *
 * 浏览器这边的硬约束（不是 bug，是 WebUSB 的设计）：
 *  - 必须由用户手势调起 navigator.usb.requestDevice() 授权，之后同源页面才能静默列举设备；
 *  - USB 接口是独占的，adb server / Android Studio / scrcpy 拿着的时候 claim 不到（设备忙）；
 *  - 页面必须是安全上下文（https / localhost / 127.0.0.1），file:// 直接打开不行。
 *
 * Tango 体积不小，这里按「用到才加载」处理：没切到 USB 引擎就不会下载这块代码。
 */
import { credentialStore } from './credentials.js'

const ADB_FILTER = { classCode: 0xff, subclassCode: 0x42, protocolCode: 1 }

let modsPromise = null

function loadMods() {
  if (!modsPromise) {
    modsPromise = Promise.all([import('@yume-chan/adb'), import('@yume-chan/adb-daemon-webusb')]).then(
      ([core, webusb]) => ({ core, webusb }),
    )
    modsPromise.catch(() => {
      modsPromise = null
    })
  }
  return modsPromise
}

/* ------------------------------ 可用性 ------------------------------ */
export function supported() {
  return typeof navigator !== 'undefined' && !!navigator.usb
}

export function unsupportedReason() {
  if (supported()) return ''
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return '当前页面不是安全上下文：WebUSB 只能用 https、localhost 或 127.0.0.1 打开，file:// 直接双击打不开'
  }
  return '当前浏览器没有 WebUSB：请用 Chrome / Edge 89+ 打开（Firefox、Safari 暂不支持）'
}

async function manager() {
  if (!supported()) throw new Error(unsupportedReason())
  const { webusb } = await loadMods()
  const m = webusb.AdbDaemonWebUsbDeviceManager.BROWSER
  if (!m) throw new Error(unsupportedReason())
  return m
}

function safeRead(fn, fallback = '') {
  try {
    return fn() ?? fallback
  } catch {
    return fallback
  }
}

/** 已授权过的设备（不需要用户手势） */
export async function listDevices() {
  const m = await manager()
  const devices = await m.getDevices()
  return devices
    .map((device) => ({
      device,
      serial: safeRead(() => device.serial, '') || 'unknown',
      name: safeRead(() => device.name, ''),
    }))
    .sort((a, b) => a.serial.localeCompare(b.serial))
}

/** 弹浏览器的 USB 选择框（必须由点击等用户手势触发），返回选中的设备 serial */
export async function requestDevice() {
  const m = await manager()
  const device = await m.requestDevice({ filters: [ADB_FILTER] })
  if (!device) return ''
  return safeRead(() => device.serial, '')
}

/* ------------------------------ 连接管理 ------------------------------ */
/** serial -> { adb, promise }；断线 / 出错自动摘掉，下次重新认证 */
const connections = new Map()

function explain(err) {
  const raw = String(err?.message || err || '')
  const name = String(err?.name || '')
  if (
    /DeviceBusy|NetworkError|busy|LIBUSB_ERROR_BUSY|failed to open device|claimInterface|access denied/i.test(
      `${name} ${raw}`,
    )
  ) {
    return new Error(
      'USB 接口被占用：adb server / Android Studio / scrcpy 可能正拿着这台设备。先执行 `adb kill-server`（或在设置里切到「ADB 命令」再切回来）后重试',
    )
  }
  if (/not supported|WinUSB|libusb/i.test(raw)) {
    return new Error(
      '无法打开 USB 设备：这台机器的 ADB 接口可能没绑 WinUSB 驱动。装 Google USB Driver（或厂商驱动）后重新插拔；最后手段可用 Zadig 换驱动',
    )
  }
  if (/auth|authenticat|unauthorized/i.test(raw)) {
    return new Error('ADB 认证未通过：看手机屏幕，允许这台电脑的 USB 调试（勾选「一律允许」可免每次确认）')
  }
  if (/no such device|cannot find|not found|No device|disconnected/i.test(raw)) {
    return new Error('找不到这台 USB 设备，可能已被拔出或换了接口')
  }
  return new Error(raw || 'USB 连接失败')
}

async function openConnection(serial) {
  const { core } = await loadMods()
  const candidates = await listDevices()
  const hit = candidates.find((c) => c.serial === serial)
  if (!hit) throw new Error(`未找到 USB 设备 ${serial}（确认已插好、已开启 USB 调试）`)

  let connection
  try {
    connection = await hit.device.connect()
  } catch (err) {
    throw explain(err)
  }

  let transport
  try {
    transport = await core.AdbDaemonTransport.authenticate({
      serial,
      connection,
      credentialStore,
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

/** 丢掉连接（换设备 / 拔出 / 切引擎）。必须 await：close 才会 releaseInterface */
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

/* ------------------------------ 进程通道 ------------------------------ */
/**
 * shellProtocol 有独立 stdout / stderr / exitCode；老设备没有 shell v2 时只有一个混合 output。
 * 上层统一按 { stdout, stderr, exited, kill, write } 用。
 */
function normalize(proc) {
  return {
    stdout: proc.stdout || proc.output,
    stderr: proc.stderr || null,
    exited: proc.exited || null,
    kill: () => proc.kill(),
  }
}

async function spawnProcess(serial, command) {
  const adb = await ensure(serial)
  const shell = adb.subprocess.shellProtocol
  const proc = shell ? await shell.spawn(command) : await adb.subprocess.noneProtocol.spawn(command)
  const normalized = normalize(proc)
  // Tango 在 socket 没收到 exit 包时会 reject `exited`（"Socket ended without exit message"），
  // 这个 rejection 可能在我们 await 之前就发生，先挂个兜底 catch，后面照常再处理
  normalized.exited?.catch?.(() => {})
  return normalized
}

/** 把 Web Stream 泵到回调上；通道被主动关闭时的读取异常属于正常流程 */
async function pump(readable, onChunk) {
  const reader = readable.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value && value.length) onChunk(value)
    }
  } catch {
    // ignore
  } finally {
    try {
      reader.releaseLock()
    } catch {}
  }
}

/**
 * 等退出码。
 * shell,v2 的退出包不一定会送达 —— 命令被管道另一端的 SIGPIPE 打断时 adbd 可能直接关 socket，
 * 所以给个上限，超时按正常结束处理，别死等。
 */
function waitExit(proc, ms = 1200) {
  if (!proc?.exited) return Promise.resolve(0)
  return Promise.race([
    proc.exited.then((code) => (typeof code === 'number' ? code : 0)).catch(() => -1),
    new Promise((resolve) => setTimeout(() => resolve(0), ms)),
  ])
}

/** 跑一条命令并等它结束，返回 { text, code }（stderr 混进来也没关系，解析时按内容过滤） */
export async function exec(serial, command, { timeout = 12000 } = {}) {
  const proc = await spawnProcess(serial, command)
  const chunks = []
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try {
        proc.kill()
      } catch {}
      reject(new Error(`命令超时（${timeout}ms）：${command}`))
    }, timeout)
  })
  try {
    const collect = (async () => {
      await pump(proc.stdout, (chunk) => chunks.push(chunk))
      if (proc.stderr) await pump(proc.stderr, (chunk) => chunks.push(chunk))
      const code = await waitExit(proc)
      return { code }
    })()
    const { code } = await Promise.race([collect, deadline])
    return { text: new TextDecoder().decode(concat(chunks)), code }
  } finally {
    clearTimeout(timer)
  }
}

function concat(chunks) {
  if (chunks.length === 1) return chunks[0]
  let total = 0
  for (const c of chunks) total += c.length
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  return out
}

/** 二进制输出（截屏）：必须原样拿到字节，不能过 TextDecoder */
export async function execBinary(serial, command, { timeout = 25000 } = {}) {
  const proc = await spawnProcess(serial, command)
  const chunks = []
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try {
        proc.kill()
      } catch {}
      reject(new Error(`命令超时（${timeout}ms）：${command}`))
    }, timeout)
  })
  try {
    const bytes = await Promise.race([
      (async () => {
        await pump(proc.stdout, (chunk) => chunks.push(chunk))
        await waitExit(proc)
        return concat(chunks)
      })(),
      deadline,
    ])
    return bytes
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 流式命令（录屏）：每来一块数据就回调一次，返回可以随时掐断的句柄。
 * screenrecord 的 H.264 裸流只能这么接 —— 等它整体结束就是 180 秒之后了。
 *
 * `done` 在进程结束时 resolve（正常到点 / 被 kill / 出错都会 resolve），
 * 调用方 kill 之后等它就能立刻收尾，不用轮询。
 */
export async function spawnStream(serial, command, { onChunk } = {}) {
  const proc = await spawnProcess(serial, command)
  let killed = false
  let stderr = ''
  let stop
  const stopped = new Promise((resolve) => {
    stop = resolve
  })
  const decoder = new TextDecoder()
  if (proc.stderr) {
    pump(proc.stderr, (chunk) => {
      stderr = (stderr + decoder.decode(chunk)).slice(-1500)
    })
  }
  const done = (async () => {
    // kill 之后 socket 关闭不一定马上让 reader 结束，这里和 stopped 抢一下，保证能收尾
    await Promise.race([pump(proc.stdout, (chunk) => onChunk?.(chunk)), stopped])
    const code = await waitExit(proc, 1000)
    return { code, stderr }
  })()
  done.catch(() => {})
  return {
    get stderr() {
      return stderr
    },
    done,
    kill() {
      killed = true
      try {
        proc.kill()
      } catch {}
      stop()
    },
    get killed() {
      return killed
    },
  }
}

/* ------------------------------ 常驻 shell ------------------------------ */
/**
 * 一条常驻的 `sh`，给远程触控用：down / move / up 都写进同一条通道，
 * 设备看到的才是一次连续手势，而不是三次孤立的点击。
 *
 * 创建是异步的（要先连接 + 认证），但调用方需要同步拿到句柄 ——
 * 所以这里先把写入排队，管道就绪后按顺序发出去。
 */
export function openShell(serial) {
  let writer = null
  let dead = false
  let closed = false
  let chain = Promise.resolve()
  let pending = []
  const dataHandlers = new Set()
  const closeHandlers = new Set()
  const decoder = new TextDecoder()
  let proc = null

  function emitData(text) {
    for (const fn of dataHandlers) {
      try {
        fn(text)
      } catch {}
    }
  }

  function emitClose() {
    if (closed) return
    closed = true
    for (const fn of closeHandlers) {
      try {
        fn()
      } catch {}
    }
  }

  const ready = (async () => {
    const adb = await ensure(serial)
    const shell = adb.subprocess.shellProtocol
    proc = shell ? await shell.spawn('sh') : await adb.subprocess.noneProtocol.spawn('sh')
    const stdin = proc.stdin
    writer = stdin.getWriter()
    proc.exited?.catch?.(() => {})
    const out = proc.stdout || proc.output
    const stderr = proc.stderr || null
    Promise.all([
      pump(out, (chunk) => emitData(decoder.decode(chunk, { stream: true }))),
      stderr ? pump(stderr, () => {}) : null,
    ]).finally(() => {
      dead = true
      emitClose()
    })
    // 排队期间的写入
    for (const text of pending) queueWrite(text)
    pending = []
  })().catch((err) => {
    dead = true
    emitClose()
    throw err
  })
  ready.catch(() => {})

  function queueWrite(text) {
    chain = chain
      .then(() => {
        if (dead || !writer) return
        return writer.write(new TextEncoder().encode(text))
      })
      .catch(() => {
        dead = true
        emitClose()
      })
  }

  return {
    serial,
    get dead() {
      return dead
    },
    write(text) {
      if (dead) return false
      if (!writer) {
        pending.push(text)
        return true
      }
      queueWrite(text)
      return true
    },
    onData(fn) {
      dataHandlers.add(fn)
    },
    onClose(fn) {
      closeHandlers.add(fn)
    },
    async close() {
      if (dead) return
      dead = true
      try {
        await writer?.close()
      } catch {}
      setTimeout(() => {
        try {
          proc?.kill()
        } catch {}
      }, 300)
    },
  }
}

/** 进程退出 / 页面关闭时放掉 USB 接口，否则下次打开就是「设备忙」 */
export function dispose() {
  forget().catch(() => {})
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', dispose)
}
