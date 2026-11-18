/**
 * 设备基础信息：采集命令 + 解析 + 短期缓存。
 *
 * 解析逻辑和服务端（server/device-info.js）必须保持一致 ——
 * 同一台设备走「ADB 命令」和「USB 直连」拿到的尺寸 / 密度要一样，否则取色坐标会跟着漂。
 */

/** 一次 shell 往返把需要的属性全取回来，别为了几个字段起多次命令 */
export const INFO_SHELL_CMD = [
  'wm size',
  'wm density',
  'getprop ro.product.model',
  'getprop ro.product.brand',
  'getprop ro.build.version.release',
  'getprop ro.build.version.sdk',
  'getprop ro.sf.lcd_density',
].join('; ')

const CACHE_TTL = 15000
const cache = new Map()

export function getCachedInfo(serial, maxAge = CACHE_TTL) {
  const hit = cache.get(serial)
  if (!hit) return null
  if (maxAge > 0 && Date.now() - hit.ts > maxAge) return null
  return hit.data
}

export function setCachedInfo(serial, data) {
  cache.set(serial, { ts: Date.now(), data })
  return data
}

export function clearInfoCache(serial) {
  if (serial) cache.delete(serial)
  else cache.clear()
}

/**
 * 解析 `wm size; wm density; getprop ...` 的输出。
 * `wm size` 会同时给出 Physical / Override 两行，有 Override 时以它为准（实际画面尺寸）。
 */
export function parseDeviceInfo(serial, text) {
  const raw = String(text || '')

  let physical = null
  let override = null
  for (const m of raw.matchAll(/(Physical|Override) size:\s*(\d+)x(\d+)/g)) {
    const value = { width: Number(m[2]), height: Number(m[3]) }
    if (m[1] === 'Physical') physical = value
    else override = value
  }
  const densityMatch = raw.match(/Physical density:\s*(\d+)/)
  const props = raw
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((l) => !/size:|density:/i.test(l))

  return {
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
}
