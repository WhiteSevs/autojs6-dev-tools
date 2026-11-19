/**
 * 「USB 直连」引擎的对外接口 —— 纯前端实现，不经过任何服务端接口。
 *
 * 返回值形状和 src/backend/http.js 完全一致（{ ok, ... }），
 * 上层组件不需要知道自己这份数据是浏览器直连拿到的还是开发服务器转发的。
 */
import { env as buildEnv } from '../status.js'
import * as adb from './adb.js'
import { capturePng } from './capture.js'
import { DEMO_SCREEN, DEMO_SERIAL } from './demo.js'
import { getCachedInfo, INFO_SHELL_CMD, parseDeviceInfo, setCachedInfo } from './info.js'
import { cachedImageData, clearFrames, getFrame, getImage, latestFrame, storeImage } from './store.js'
import { cropRegion, findColor as scanColor, normalizeImage, readPixel, toImageData } from './raster.js'
import { screenPower } from './screen.js'
import { closeAllTouches } from './touch.js'

function withTimeout(promise, ms, label) {
  let timer
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}超时（${ms}ms）`)), ms)
    }),
  ])
}

const blobOf = (bytes) => new Blob([bytes], { type: 'image/png' })

/* ------------------------------ 设备列表 ------------------------------ */
export async function devices() {
  const envNow = await buildEnv()
  const demo = {
    serial: DEMO_SERIAL,
    state: 'demo',
    kind: 'demo',
    model: '演示模式（无需设备）',
    label: '演示模式（无需设备）',
    ready: true,
    screen: { ...DEMO_SCREEN },
    brand: 'AutoJs6 DevHelper',
    androidVersion: '',
  }

  if (!adb.supported()) {
    return { ok: false, adb: envNow, error: envNow.error || 'WebUSB 不可用', devices: [demo] }
  }

  try {
    const list = await adb.listDevices()
    const items = []
    for (const d of list) {
      const item = {
        serial: d.serial,
        state: 'device',
        kind: 'usb',
        model: d.name || '',
        product: d.name || '',
        device: '',
        transportId: '',
        mdnsName: '',
        label: d.name ? `${d.name} (${d.serial})` : d.serial,
        ready: true,
        screen: null,
      }
      try {
        const detail = await withTimeout(info(d.serial), 8000, '读取设备信息')
        item.screen = detail.screen
        item.brand = detail.brand
        item.androidVersion = detail.androidVersion
        item.model = item.model || detail.model
      } catch {
        // 认证还没点确认 / 设备正忙：先列出来，别让整张表因为一台设备失败
        item.screen = null
      }
      items.push(item)
    }
    return { ok: true, adb: envNow, devices: [...items, demo] }
  } catch (err) {
    return { ok: false, adb: envNow, error: err.message, devices: [demo] }
  }
}

/** 弹浏览器的 USB 权限框。必须由点击直接触发，否则 Chrome 会拒绝 */
export async function requestUsbDevice() {
  const serial = await adb.requestDevice()
  return { ok: true, serial }
}

/* ------------------------------ 设备信息 ------------------------------ */
export async function info(serial, { force = false } = {}) {
  if (serial === DEMO_SERIAL) {
    return {
      ok: true,
      demo: true,
      serial,
      model: '演示模式',
      brand: 'AutoJs6 DevHelper',
      androidVersion: '',
      sdk: '',
      screen: { ...DEMO_SCREEN },
      physical: { ...DEMO_SCREEN },
      override: null,
      density: 480,
    }
  }
  if (!force) {
    const cached = getCachedInfo(serial)
    if (cached) return { ok: true, demo: false, ...cached }
  }
  const image = getImage(serial)
  if (image) {
    const detail = {
      serial,
      model: image.name || '本地图片',
      brand: '图片数据源',
      androidVersion: '',
      sdk: '',
      screen: { width: image.width, height: image.height },
      physical: { width: image.width, height: image.height },
      override: null,
      density: 0,
    }
    return { ok: true, demo: false, ...setCachedInfo(serial, detail) }
  }
  const { text } = await adb.exec(serial, INFO_SHELL_CMD, { timeout: 10000 })
  return { ok: true, demo: false, ...setCachedInfo(serial, parseDeviceInfo(serial, text)) }
}

/* ------------------------------ 帧与像素 ------------------------------ */
/**
 * 取一帧用于取色 / 找色 / 裁剪的原始 PNG。
 * frameId 命中 → 用「你正在看的那一帧」；录屏模式下没有帧缓冲 → 现截一张，保证像素无损。
 */
async function resolvePng(serial, frameId, { fresh = false } = {}) {
  const frame = getFrame(serial, frameId)
  if (frame) return frame
  if (fresh) return capturePng(serial)
  const recent = latestFrame(serial, 2500)
  if (recent) return recent
  return capturePng(serial)
}

export async function pixel(serial, x, y, frameId, fresh) {
  const png = await resolvePng(serial, frameId, { fresh })
  const imageData = await cachedImageData(png, () => toImageData(png))
  return { ok: true, ...readPixel(imageData, x, y) }
}

export async function findColor(payload) {
  const { serial, color, threshold = 4, region = null, limit = 500, frameId, fresh = false } = payload || {}
  const png = await resolvePng(serial, frameId, { fresh })
  const imageData = await cachedImageData(png, () => toImageData(png))
  return { ok: true, ...scanColor(imageData, { color, threshold, region, limit }) }
}

/** 按 1:1 原始像素导出截图（整屏或区域） */
export async function shotBlob(payload = {}) {
  const { serial, frameId, region, fresh } = payload
  const png = await resolvePng(serial, frameId, { fresh })
  if (region && Number.isFinite(Number(region.w ?? region.width))) {
    const { bytes } = await cropRegion(png, region)
    return blobOf(bytes)
  }
  return blobOf(png)
}

/** 把外部上传的图片存成本地数据源（和真机共用同一套取色 / 找色管线） */
export async function uploadImage({ name = 'image', dataUrl } = {}) {
  const raw = String(dataUrl || '')
  if (!raw) throw new Error('缺少图片数据')
  const blob = await (await fetch(raw)).blob()
  const bytes = new Uint8Array(await blob.arrayBuffer())
  if (!bytes.length) throw new Error('图片数据为空')
  const normalized = await normalizeImage(bytes)
  const serial = storeImage(normalized.bytes, {
    width: normalized.width,
    height: normalized.height,
    name: String(name).slice(0, 120),
  })
  return {
    ok: true,
    serial,
    name,
    width: normalized.width,
    height: normalized.height,
    format: 'png',
    bytes: normalized.bytes.length,
  }
}

/* ------------------------------ 设备操作 ------------------------------ */
export async function tap(serial, x, y) {
  if (serial === DEMO_SERIAL) return { ok: true, message: '演示模式：已模拟点击' }
  const { code, text } = await adb.exec(serial, `input tap ${Math.round(x)} ${Math.round(y)}`)
  return { ok: code === 0, message: text.trim() || `tap ${Math.round(x)},${Math.round(y)}` }
}

export async function swipe(serial, { x1, y1, x2, y2, duration = 300 }) {
  if (serial === DEMO_SERIAL) return { ok: true, message: '演示模式：已模拟滑动' }
  const cmd = `input swipe ${Math.round(x1)} ${Math.round(y1)} ${Math.round(x2)} ${Math.round(y2)} ${Math.round(duration)}`
  const { code, text } = await adb.exec(serial, cmd)
  return { ok: code === 0, message: text.trim() || 'swipe done' }
}

/** 长按拖拽（排序 / 拖放）：老系统没有 draganddrop 时退回 motionevent 组合 */
export async function drag(payload) {
  const { serial, x1, y1, x2, y2, duration = 800 } = payload
  if (serial === DEMO_SERIAL) return { ok: true, message: '演示模式：已模拟长按拖拽' }
  const px1 = Math.round(x1)
  const py1 = Math.round(y1)
  const px2 = Math.round(x2)
  const py2 = Math.round(y2)
  const main = `input draganddrop ${px1} ${py1} ${px2} ${py2} ${Math.round(duration)}`
  const first = await adb.exec(serial, main)
  if (first.code === 0) return { ok: true, message: first.text.trim() || 'drag done' }

  const fallback = [
    `input motionevent DOWN ${px1} ${py1};`,
    'sleep 0.7;',
    `input motionevent MOVE ${px2} ${py2};`,
    `input motionevent UP ${px2} ${py2}`,
  ].join(' ')
  const second = await adb.exec(serial, fallback)
  return {
    ok: second.code === 0,
    message: second.code === 0 ? 'drag（motionevent 回退）' : second.text.trim() || first.text.trim(),
  }
}

const KEY_CODES = {
  back: 4,
  home: 3,
  recents: 187,
  app_switch: 187,
  power: 26,
  wakeup: 224,
  sleep: 223,
  menu: 82,
  enter: 66,
  delete: 67,
  // 键盘 Delete 键是「向后删除」，和退格(67)不是一回事
  forward_del: 112,
  space: 62,
  volume_up: 24,
  volume_down: 25,
  volume_mute: 164,
  camera: 27,
  escape: 111,
  tab: 61,
  search: 84,
  dpad_up: 19,
  dpad_down: 20,
  dpad_left: 21,
  dpad_right: 22,
  dpad_center: 23,
}

export async function key(serial, name) {
  if (serial === DEMO_SERIAL) return { ok: true, message: `演示模式：已模拟按键 ${name}` }
  const code = KEY_CODES[name] ?? Number(name)
  if (!Number.isFinite(code)) throw new Error(`未知按键：${name}`)
  const r = await adb.exec(serial, `input keyevent ${code}`)
  return { ok: r.code === 0, message: r.text.trim() || `key ${name}` }
}

export async function screen(serial, action) {
  if (serial === DEMO_SERIAL) {
    return { ok: true, message: action === 'lock' ? '演示模式：已模拟锁屏' : '演示模式：已模拟解锁' }
  }
  if (action !== 'lock' && action !== 'unlock') throw new Error('action 只能是 lock 或 unlock')
  return screenPower(serial, action)
}

/* ------------------------------ 供引擎切换复用 ------------------------------ */
export { clearFrames }

/** 页面卸载 / 切引擎：放掉 USB 接口与触摸通道 */
export function dispose() {
  closeAllTouches()
  adb.dispose()
}
