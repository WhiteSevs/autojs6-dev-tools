/**
 * 连接引擎注册表 + 设置持久化。
 *
 * 「连接引擎」决定服务端用哪条路子和手机通信：
 *   adb     —— 起 adb 命令（platform-tools），支持无线调试 / mDNS 发现
 *   webusb  —— 内置 ADB 协议栈直接走 USB，不需要装 platform-tools
 *
 * 两者互斥：USB 接口同一时刻只能被一个程序占用，所以切换后要断开旧连接。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as adbCli from './engines/adb-cli.js'
import * as webusb from './engines/webusb.js'
import { clearInfoCache } from './device-info.js'
import { runAdb } from './adb.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SETTINGS_FILE = path.join(ROOT, '.adb-helper.json')

const ENGINES = [adbCli, webusb]
const byId = new Map(ENGINES.map((e) => [e.id, e]))
export const DEFAULT_ENGINE = 'adb'

let state = null

function read() {
  if (state) return state
  state = { engine: DEFAULT_ENGINE }
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))
    if (raw && byId.has(raw.engine)) state.engine = raw.engine
  } catch {
    // 没有配置文件 / 内容损坏都走默认值，不需要打扰用户
  }
  return state
}

/**
 * 落盘失败不能静默：内存里的选择生效了、文件里还是旧值，
 * 用户看到「界面上是 A、重启后变 B」会以为是 bug。返回结果交给调用方提示。
 */
function persist() {
  try {
    fs.writeFileSync(SETTINGS_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    return { ok: true, error: '' }
  } catch (err) {
    return { ok: false, error: err.message || String(err) }
  }
}

/** 当前生效的引擎模块 */
export function current() {
  return byId.get(read().engine) || adbCli
}

export function currentId() {
  return read().engine
}

export function engineById(id) {
  return byId.get(id) || null
}

/* ------------------------------ 可用性探测 ------------------------------ */
/** 探测要起进程 / 加载原生模块，缓存几秒，避免每次刷设备列表都重探 */
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

/** 服务关闭 / 进程退出时释放独占资源（USB 接口被握着的话，下次启动会打不开设备） */
export function dispose() {
  webusb.forget()
}

/**
 * 释放 adb server 对设备的占用。
 * USB 接口是独占的：adb server 拿着接口时，USB 直连根本 claim 不到（Windows 上就是 error 5）。
 * 既然用户显式切到「USB 直连」，这一步就代劳了；adb 需要时会自动把 server 再拉起来。
 */
async function releaseAdbServer() {
  try {
    const r = await runAdb(['kill-server'], { timeout: 8000 })
    return { ok: true, message: (r.text || r.stderr || '').trim() }
  } catch (err) {
    return { ok: false, message: err.message }
  }
}

/**
 * 切换引擎。
 * 切换时要断掉旧引擎握着的设备、清掉信息缓存，否则新引擎拿到的是上一轮的状态。
 */
export async function setEngine(id) {
  if (!byId.has(id)) throw new Error(`未知的连接引擎：${id}`)
  const prev = currentId()
  read().engine = id
  let released = null
  if (prev !== id) {
    // 先把上一轮握着的接口真正放开（close 是异步的），否则新引擎一 claim 就是 error 5
    await webusb.forget()
    clearInfoCache()
    if (id === 'webusb' && prev === 'adb') {
      released = await releaseAdbServer()
    }
    // 驱动回收句柄有个几毫秒到几百毫秒的滞后，给它一点时间
    await new Promise((r) => setTimeout(r, 350))
  }
  const saved = persist()
  probeCache.delete(id)
  const result = await status({ force: true })
  return {
    ...result,
    persisted: saved.ok,
    releasedAdb: released ? released.ok : null,
    warning: saved.ok ? '' : `选择已生效，但写入 ${SETTINGS_FILE} 失败（${saved.error}），重启后会回到上一次保存的引擎`,
  }
}
