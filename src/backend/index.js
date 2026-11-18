/**
 * 统一入口：按「连接引擎」把调用分给两个完全不同的后端。
 *
 *  - adb    → 开发服务器的 /api/*（要起 adb 进程、读本机 adbkey，浏览器做不了）
 *  - webusb → ./local/（浏览器里用 WebUSB + Tango 直接和 adbd 说话，不需要任何后端）
 *
 * 两条路的返回值形状完全一致，所以组件只认 api.*，不关心背后是谁。
 */
import { http, httpShotBlob } from './http.js'
import * as local from './local/index.js'
import { restoreStayAwake } from './local/screen.js'
import { isLocalEngine, readSavedEngine, runtime, saveEngine } from './runtime.js'
import { env as buildEnv } from './status.js'

export { runtime, isLocalEngine }

const unsupportedWireless = () => {
  throw new Error('当前连接引擎不支持无线调试，切到「ADB 命令」后可用')
}

/* ------------------------------ 启动探测 ------------------------------ */
/**
 * 一次性探测：有没有开发服务器、该用哪个引擎。
 * 没有后端时直接落到 USB 直连 —— 纯静态部署也能插上手机就用。
 */
export async function boot() {
  if (runtime.booted) return runtime
  runtime.booted = true
  try {
    runtime.server = await http.env()
    runtime.serverError = ''
  } catch (err) {
    runtime.server = null
    runtime.serverError = err.message || '没有可用的开发服务器'
  }
  const saved = readSavedEngine()
  if (!runtime.server) runtime.engine = 'webusb'
  else runtime.engine = saved === 'webusb' ? 'webusb' : 'adb'
  return runtime
}

/* ------------------------------ 切换引擎 ------------------------------ */
/** USB 接口是独占的：换引擎前后都得把旧那条彻底放开，否则新引擎一 claim 就是「设备忙」 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function setEngine(id) {
  if (id !== 'adb' && id !== 'webusb') throw new Error(`未知的连接引擎：${id}`)
  if (id === runtime.engine) return { ok: true, env: await api.env(), releasedAdb: null, warning: '' }

  if (id === 'adb') {
    if (!runtime.server) {
      throw new Error('「ADB 命令」需要开发服务器（npm run dev），纯前端页面只能用 USB 直连')
    }
    local.dispose()
    runtime.engine = 'adb'
    saveEngine('adb')
    await sleep(200)
    return { ok: true, env: await api.env(), releasedAdb: null, warning: '' }
  }

  local.clearFrames()
  runtime.engine = 'webusb'
  saveEngine('webusb')
  let releasedAdb = null
  let warning = ''
  if (runtime.server) {
    // adb server 握着 USB 接口时 WebUSB 根本 claim 不到（Windows 上就是 error 5），
    // 既然用户显式切过来，这一步替它做了；adb 需要时会自己再把 server 拉起来
    try {
      const r = await http.releaseAdb()
      releasedAdb = !!r.ok
    } catch (err) {
      warning = `切换已生效，但没能释放 adb server（${err.message}）；若提示接口被占用，请手动执行 adb kill-server`
    }
    // 驱动回收句柄有几个毫秒到几百毫秒的滞后，给它一点时间
    await sleep(350)
  }
  return { ok: true, env: await api.env(), releasedAdb, warning }
}

/* ------------------------------ 门面 ------------------------------ */
export const api = {
  boot,
  /** 两条引擎的状态都要给（设置里是两张卡片），合成逻辑见 ./status.js */
  env: () => buildEnv(),
  /** 连接引擎状态（历史接口，等价于 env 里的 engines 段） */
  settings: () => (isLocalEngine() ? buildEnv() : http.settings()),
  /**
   * 设备列表。adb 模式下服务端会顺手回一份自己的 env，但那份里只有 adb 一个引擎，
   * 直接用它会把设置里的「USB 直连」卡片抹掉，所以统一换成合成过的状态。
   */
  devices: async () => {
    if (isLocalEngine()) return local.devices()
    const res = await http.devices()
    return { ...res, adb: await buildEnv() }
  },
  /** mDNS 局域网发现只有 adb 引擎有 */
  mdns: (refresh) => (isLocalEngine() ? Promise.resolve({ ok: true, supported: false, services: [] }) : http.mdns(refresh)),
  pair: (address, code) => (isLocalEngine() ? unsupportedWireless() : http.pair(address, code)),
  connect: (address) => (isLocalEngine() ? unsupportedWireless() : http.connect(address)),
  disconnect: (address) => (isLocalEngine() ? unsupportedWireless() : http.disconnect(address)),
  info: (serial, options) => (isLocalEngine() ? local.info(serial, options) : http.info(serial)),
  pixel: (serial, x, y, frameId, fresh) =>
    isLocalEngine() ? local.pixel(serial, x, y, frameId, fresh) : http.pixel(serial, x, y, frameId, fresh),
  findColor: (payload) => (isLocalEngine() ? local.findColor(payload) : http.findColor(payload)),
  tap: (serial, x, y) => (isLocalEngine() ? local.tap(serial, x, y) : http.tap(serial, x, y)),
  swipe: (payload) => (isLocalEngine() ? local.swipe(payload.serial, payload) : http.swipe(payload)),
  drag: (payload) => (isLocalEngine() ? local.drag(payload) : http.drag(payload)),
  key: (serial, key) => (isLocalEngine() ? local.key(serial, key) : http.key(serial, key)),
  screen: (serial, action) => (isLocalEngine() ? local.screen(serial, action) : http.screen(serial, action)),
  uploadImage: (payload) => (isLocalEngine() ? local.uploadImage(payload) : http.uploadImage(payload)),
  /** 弹浏览器的 USB 授权框（只有 USB 直连引擎用得到） */
  requestUsbDevice: () => (isLocalEngine() ? local.requestUsbDevice() : Promise.resolve({ ok: false, serial: '' })),
  snapshotUrl: (serial, scale) => (isLocalEngine() ? '' : http.snapshotUrl(serial, scale)),
  setEngine,
}

/** 按 1:1 原始像素导出截图（整屏或指定区域），返回 PNG Blob */
export function shotBlob(payload) {
  return isLocalEngine() ? local.shotBlob(payload) : httpShotBlob(payload)
}

/** 页面关闭 / 卸载：别把 USB 接口和「按着的手指」留在这儿 */
export function dispose() {
  if (isLocalEngine()) local.dispose()
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    dispose()
    // 解锁时临时打开过「充电时保持唤醒」，离开页面记得还原
    if (isLocalEngine()) restoreStayAwake().catch(() => {})
  })
}
