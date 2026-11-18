/**
 * 运行时状态：当前用哪条连接引擎、开发服务器在不在。
 *
 * 这里刻意不依赖 Vue —— 推流、取色这些是纯逻辑模块，
 * 让它们直接读这份状态比一路把 ref 传下去省事，也不会因为响应式包装改变行为。
 */

export const ENGINE_STORAGE_KEY = 'autojs6.engine.v1'

/**
 * engine: 'adb'（服务端 adb 命令）| 'webusb'（浏览器 WebUSB 直连）
 * server: 探测到的服务端 env，纯前端运行时为 null
 * serverError: 服务端探测失败的原因，用于界面上解释「ADB 命令」为什么不可用
 */
export const runtime = {
  engine: 'adb',
  server: null,
  serverError: '',
  /** 是否已经在启动时探过一次（避免重复探测） */
  booted: false,
}

export function isLocalEngine() {
  return runtime.engine === 'webusb'
}

export function readSavedEngine() {
  try {
    const v = localStorage.getItem(ENGINE_STORAGE_KEY)
    return v === 'webusb' || v === 'adb' ? v : ''
  } catch {
    return ''
  }
}

export function saveEngine(engine) {
  try {
    localStorage.setItem(ENGINE_STORAGE_KEY, engine)
  } catch {}
}
