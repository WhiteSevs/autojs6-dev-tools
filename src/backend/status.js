/**
 * 「连接引擎」状态合成：把两边的信息拼成一份前端能直接用的 env。
 *
 * 两个引擎分属两个世界：
 *  - adb    由开发服务器探测（有没有装 platform-tools），没有后端时就明确不可用；
 *  - webusb 由浏览器自己探测（有没有 WebUSB、授权了几台设备）。
 *
 * 设置面板要同时看到两张卡片，所以不管当前用哪条引擎，这里都要把两边都探一遍。
 */
import { http } from './http.js'
import * as adb from './local/adb.js'
import { runtime } from './runtime.js'

/** 服务端引擎（ADB 命令）：后端在就用真实探测结果，不在就明确说明原因 */
function adbEntry() {
  const hit = runtime.server?.engines?.find((e) => e.id === 'adb')
  if (hit) return { ...hit, capabilities: hit.capabilities || { usb: true, wireless: true, mdns: true } }
  return {
    id: 'adb',
    label: 'ADB 命令',
    short: 'ADB',
    desc: '由开发服务器调用 platform-tools 的 adb 命令，支持无线调试与局域网自动发现',
    capabilities: { usb: true, wireless: true, mdns: true },
    ok: false,
    detail: '',
    path: '',
    error: runtime.serverError || '当前是纯前端运行（没有开发服务器），adb 命令不可用',
    hint: '需要无线调试 / mDNS 发现时用 npm run dev 启动；USB 直连不需要它',
  }
}

/** USB 直连：浏览器支持 WebUSB 就算就绪，没授权设备只影响设备列表 */
export async function usbEntry() {
  const base = {
    id: 'webusb',
    label: 'USB 直连',
    short: 'WebUSB',
    desc: '浏览器内置 ADB 协议栈直接走 USB，不需要 platform-tools，也不需要 Node 后端',
    capabilities: { usb: true, wireless: false, mdns: false },
  }
  if (!adb.supported()) {
    return {
      ...base,
      ok: false,
      detail: '',
      path: '',
      error: adb.unsupportedReason(),
      hint: '用 Chrome / Edge 打开，页面走 http://localhost 或 https',
    }
  }
  try {
    const list = await adb.listDevices()
    return {
      ...base,
      ok: true,
      detail: list.length
        ? `已授权 ${list.length} 台设备 · ${list.map((d) => d.name || d.serial).join('、')}`
        : '尚未授权设备 · 点顶栏「USB 设备」授权',
      path: '',
      error: '',
      hint: '',
    }
  } catch (err) {
    return { ...base, ok: false, detail: '', path: '', error: err.message, hint: '' }
  }
}

/** 当前引擎的 version 文案（顶栏 / 状态栏 / 设置里的「关于」都用它） */
function versionOf(engine) {
  if (!engine.ok) return ''
  return engine.id === 'webusb' ? `USB 直连 · ${engine.detail}` : engine.detail
}

export async function env() {
  // adb 模式顺手确认一下服务端还在：中途关掉 npm run dev 时，界面要能立刻反映出来
  if (runtime.engine === 'adb') {
    try {
      runtime.server = await http.env()
      runtime.serverError = ''
    } catch (err) {
      runtime.server = null
      runtime.serverError = err.message || '开发服务器已断开'
    }
  }

  const engines = [adbEntry(), await usbEntry()]
  const current = engines.find((e) => e.id === runtime.engine) || engines.find((e) => e.ok) || engines[0]
  return {
    ok: !!current.ok,
    version: versionOf(current),
    adbPath: current.id === 'adb' ? current.path || '' : '',
    error: current.ok ? '' : current.error || '',
    hint: current.hint || '',
    engine: current.id,
    engineLabel: current.label,
    engineShort: current.short,
    engines,
    local: current.id === 'webusb',
    platform: runtime.server?.platform || 'browser',
    platformLabel: runtime.server ? '' : '浏览器',
    node: runtime.server?.node || '',
  }
}
