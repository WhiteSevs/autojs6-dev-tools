/**
 * 浏览器端的位图运算：解码、取色、找色、裁剪、缩放。
 *
 * 服务端靠 sharp 做这些事，纯前端只能用 Canvas。语义必须和 server/frame.js 对齐：
 *  - 取色取的是**原始截图**的像素，不是缩放后的预览帧；
 *  - 找色和 AutoJs6 的 images.findColor 一致，逐通道比较差值；
 *  - 裁剪按 1:1 原始像素导出 PNG，不缩放、不插值。
 */
import { toHex as fmtHex, toRgb } from '../../utils/color'

/** 优先用 OffscreenCanvas（不占 DOM、能在线程里用），老一点的环境退回 <canvas> */
export function createCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

export function canvasToBlob(canvas, type = 'image/png') {
  if (typeof canvas.convertToBlob === 'function') return canvas.convertToBlob({ type })
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('图片编码失败'))), type)
  })
}

export async function canvasToBytes(canvas, type = 'image/png') {
  const blob = await canvasToBlob(canvas, type)
  return new Uint8Array(await blob.arrayBuffer())
}

export function toBlob(bytes, type = 'image/png') {
  return new Blob([bytes], { type })
}

/** PNG 头里直接读宽高（IHDR：8 字节签名 + 4 长度 + 4 类型 + 8 有效载荷） */
export function pngSize(bytes) {
  if (!bytes || bytes.length < 24) return { width: 0, height: 0 }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const isPng =
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  if (!isPng) return { width: 0, height: 0 }
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

export async function decodeBitmap(bytes) {
  const blob = bytes instanceof Blob ? bytes : toBlob(bytes)
  return createImageBitmap(blob)
}

/** 解码成 RGBA 像素（取色 / 找色的统一入口） */
export async function toImageData(bytes) {
  const bitmap = await decodeBitmap(bytes)
  const canvas = createCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(bitmap, 0, 0)
  const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
  try {
    bitmap.close?.()
  } catch {}
  return data
}

/** 精确读取某个像素（坐标按设备像素，越界自动夹到边缘） */
export function readPixel(imageData, x, y) {
  const { width, height, data } = imageData
  const px = Math.max(0, Math.min(width - 1, Math.floor(Number(x) || 0)))
  const py = Math.max(0, Math.min(height - 1, Math.floor(Number(y) || 0)))
  const idx = (py * width + px) * 4
  const r = data[idx]
  const g = data[idx + 1]
  const b = data[idx + 2]
  const a = data[idx + 3]
  return {
    x: px,
    y: py,
    r,
    g,
    b,
    a,
    hex: fmtHex({ r, g, b }),
    decimal: ((r << 16) | (g << 8) | b) >>> 0,
  }
}

/**
 * 全屏找色（与 AutoJs6 images.findColor 语义一致：逐通道容差判定）
 * threshold 为每通道允许的最大差值
 */
export function findColor(imageData, options = {}) {
  const { color, threshold = 4, region = null, limit = 500, stride = 1 } = options
  const target = toRgb(color)
  if (!target) throw new Error(`无法解析颜色值：${color}`)
  const tol = Math.max(0, Math.min(255, Math.round(threshold)))
  const started = performance.now()

  const { width, height, data } = imageData
  let rx = 0
  let ry = 0
  let rw = width
  let rh = height
  if (region && Number.isFinite(region.x) && Number.isFinite(region.y)) {
    rx = Math.max(0, Math.floor(region.x))
    ry = Math.max(0, Math.floor(region.y))
    rw = Math.min(width - rx, Math.max(1, Math.floor(region.w ?? region.width ?? width)))
    rh = Math.min(height - ry, Math.max(1, Math.floor(region.h ?? region.height ?? height)))
  }

  const { r: tr, g: tg, b: tb } = target
  const step = Math.max(1, Math.round(stride))
  const matches = []
  let total = 0
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (let y = ry; y < ry + rh; y += step) {
    let idx = (y * width + rx) * 4
    for (let x = rx; x < rx + rw; x += step, idx += 4 * step) {
      const dr = data[idx] - tr
      const dg = data[idx + 1] - tg
      const db = data[idx + 2] - tb
      if ((dr < 0 ? -dr : dr) <= tol && (dg < 0 ? -dg : dg) <= tol && (db < 0 ? -db : db) <= tol) {
        total++
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
        if (matches.length < limit) matches.push({ x, y })
      }
    }
  }

  return {
    color: fmtHex(target),
    threshold: tol,
    region: { x: rx, y: ry, w: rw, h: rh },
    frame: { width, height },
    total,
    truncated: total > matches.length,
    matches,
    bbox: total > 0 ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null,
    elapsed: Math.round(performance.now() - started),
  }
}

/** 裁剪区域并按 1:1 原始像素导出 PNG */
export async function cropRegion(bytes, region) {
  const bitmap = await decodeBitmap(bytes)
  const W = bitmap.width
  const H = bitmap.height
  const left = Math.max(0, Math.min(W - 1, Math.round(Number(region.x) || 0)))
  const top = Math.max(0, Math.min(H - 1, Math.round(Number(region.y) || 0)))
  const width = Math.max(1, Math.min(W - left, Math.round(Number(region.w ?? region.width) || 1)))
  const height = Math.max(1, Math.min(H - top, Math.round(Number(region.h ?? region.height) || 1)))

  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(bitmap, left, top, width, height, 0, 0, width, height)
  try {
    bitmap.close?.()
  } catch {}
  const out = await canvasToBytes(canvas)
  return { bytes: out, x: left, y: top, width, height }
}

/**
 * 按整数倍缩小并重新编码成 PNG。
 * 服务端用 sharp 的 nearest 采样；这里关掉 imageSmoothing 拿到同样的效果 ——
 * 预览里不会出现设备上不存在的颜色。
 */
export async function scalePng(bytes, scale) {
  const s = Math.max(1, Math.round(Number(scale) || 1))
  // 原画 1:1：连解码都省了，直接透传截屏的原始字节（字节级一致，0 像素损失）
  if (s === 1) {
    const { width, height } = pngSize(bytes)
    return { bytes, width, height, deviceWidth: width, deviceHeight: height, scale: 1 }
  }
  const bitmap = await decodeBitmap(bytes)
  const deviceWidth = bitmap.width
  const deviceHeight = bitmap.height
  const width = Math.max(1, Math.round(deviceWidth / s))
  const height = Math.max(1, Math.round(deviceHeight / s))
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(bitmap, 0, 0, deviceWidth, deviceHeight, 0, 0, width, height)
  try {
    bitmap.close?.()
  } catch {}
  const out = await canvasToBytes(canvas)
  return { bytes: out, width, height, deviceWidth, deviceHeight, scale: s }
}

/** 把任意图片（png / jpg / webp…）归一化成 PNG，用于本地图片数据源 */
export async function normalizeImage(bytes) {
  const bitmap = await decodeBitmap(bytes)
  const width = bitmap.width
  const height = bitmap.height
  if (!width || !height) throw new Error('无法解析图片尺寸，可能不是有效图片')
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(bitmap, 0, 0)
  try {
    bitmap.close?.()
  } catch {}
  return { bytes: await canvasToBytes(canvas), width, height, format: 'png' }
}
