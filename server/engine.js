/**
 * 开发服务器侧的连接引擎 —— 现在只剩「ADB 命令」这一个。
 *
 * 原来这里还有一个「USB 直连（服务端 usb 包）」引擎，已经整体搬到前端
 * （src/backend/local/），由浏览器用 WebUSB 直接和 adbd 通信：
 * 不占 Node 进程、不需要原生模块，打包成静态站点也能用。
 *
 * 这里保留引擎模块的形状（current / status / capabilities），
 * 是因为无线调试、mDNS 这些能力长在 adb 自己身上，前端仍要靠 capabilities 决定显不显示入口。
 */
import * as adbCli from './engines/adb-cli.js'
import { runAdb } from './adb.js'

const ENGINES = [adbCli]
const byId = new Map(ENGINES.map((e) => [e.id, e]))
export const DEFAULT_ENGINE = 'adb'

/** 当前生效的引擎模块 */
export function current() {
  return adbCli
}

export function currentId() {
  return adbCli.id
}

export function engineById(id) {
  return byId.get(id) || null
}

/* ------------------------------ 可用性探测 ------------------------------ */
/** 探测要起进程，缓存几秒，避免每次刷设备列表都重探 */
const probeCache = new Map()
const PROBE_TTL = 5000

async function probeOf(engine, { force = false } = {}) {
  const hit = probeCache.get(engine.id)
  if (!force && hit && Date.now() - hit.at < PROBE_TTL) return hit.result
  let result
  try {
    result = await engine.probe()
  } catch (err) {
    result = { ok: false, detail: '', error: err.message || String(err), hint: '' }
  }
  probeCache.set(engine.id, { at: Date.now(), result })
  return result
}

/** 给前端用的全景状态：当前引擎 + 每个引擎是否可用 */
export async function status({ force = false } = {}) {
  const list = []
  for (const engine of ENGINES) {
    const p = await probeOf(engine, { force })
    list.push({
      id: engine.id,
      label: engine.label,
      short: engine.short,
      desc: engine.desc,
      capabilities: engine.capabilities,
      ok: !!p.ok,
      detail: p.detail || '',
      path: p.adbPath || '',
      error: p.error || '',
      hint: p.hint || '',
    })
  }
  return { current: currentId(), engines: list }
}

/**
 * 切换引擎。
 * 目前只剩 adb 一条路，保留这个入口是为了让前端的「连接引擎」设置仍然有明确报错，
 * 而不是静默接受一个做不到的选择（比如在没有后端时选「ADB 命令」）。
 */
export async function setEngine(id) {
  if (!byId.has(id)) {
    throw new Error(`未知的连接引擎：${id}（USB 直连已改由浏览器实现，不再经过服务端）`)
  }
  probeCache.delete(id)
  return status({ force: true })
}

/** 服务关闭 / 进程退出时的收尾钩子（adb 引擎起的是短命进程，没有需要长握的资源） */
export function dispose() {}

/**
 * 释放 adb server 对设备的占用。
 * USB 接口是独占的：adb server 拿着接口时，浏览器里的 WebUSB 根本 claim 不到（Windows 上就是 error 5）。
 * 既然用户在设置里显式切到「USB 直连」，这一步就代劳了；adb 需要时会自动把 server 再拉起来。
 */
export async function releaseAdbServer() {
  try {
    const r = await runAdb(['kill-server'], { timeout: 8000 })
    return { ok: true, message: (r.text || r.stderr || '').trim() }
  } catch (err) {
    return { ok: false, message: err.message }
  }
}
