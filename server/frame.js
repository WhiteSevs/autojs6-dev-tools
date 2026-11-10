import sharp from 'sharp'

sharp.cache(false)
sharp.concurrency(2)

/** 解析 #RRGGBB / #RGB / rgb(r,g,b) / 十进制颜色值 */
export function parseColor(input) {
  if (typeof input === 'number') {
    return { r: (input >> 16) & 0xff, g: (input >> 8) & 0xff, b: input & 0xff }
  }
  const raw = String(input || '').trim()
  const hexMatch = raw.match(/^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i)
  if (hexMatch) {
    let hex = hexMatch[1]
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('')
    if (hex.length === 8) hex = hex.slice(0, 6)
    const num = parseInt(hex, 16)
    return { r: (num >> 16) & 0xff, g: (num >> 8) & 0xff, b: num & 0xff }
  }
  const rgbMatch = raw.match(/rgba?\(([^)]+)\)/i)
  if (rgbMatch) {
    const [r, g, b] = rgbMatch[1].split(',').map((v) => Number(v.trim()))
    return { r: r | 0, g: g | 0, b: b | 0 }
  }
  throw new Error(`无法解析颜色值：${input}`)
}

export const toHex = (r, g, b) =>
  '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('').toUpperCase()

export function toDecimal(r, g, b) {
  return ((r << 16) | (g << 8) | b) >>> 0
}

/**
 * 把截屏 PNG 缩放后重新编码为 PNG 用于投屏（无损，保证预览像素与取色像素完全一致）
 * scale 为整数倍缩小（nearest 保证不引入插值误差）
 * compressionLevel 只影响体积/速度，不影响像素
 */
export async function encodeFrame(pngBuf, { scale = 3, compressionLevel = 3 } = {}) {
  const meta = await sharp(pngBuf).metadata()
  const deviceWidth = meta.width || 0
  const deviceHeight = meta.height || 0
  const s = Math.max(1, Math.round(scale))
  const outWidth = Math.max(1, Math.round(deviceWidth / s))
  const outHeight = Math.max(1, Math.round(deviceHeight / s))

  // 原画 1:1：直接下发 screencap 的原始 PNG 字节。
  // 不重编码 = 0 毫秒、0 像素损失，且体积比 sharp 重编码更小（实测 3.2MB vs 6.3MB）。
  if (s === 1 && meta.format === 'png') {
    return { buffer: pngBuf, width: deviceWidth, height: deviceHeight, deviceWidth, deviceHeight, scale: 1, format: 'png' }
  }

  let pipe = sharp(pngBuf).removeAlpha()
  if (s > 1) pipe = pipe.resize({ width: outWidth, height: outHeight, kernel: 'nearest', fit: 'fill' })

  const png = await pipe
    .png({ compressionLevel: Math.max(0, Math.min(9, Math.round(compressionLevel))), adaptiveFiltering: false })
    .toBuffer()

  return { buffer: png, width: outWidth, height: outHeight, deviceWidth, deviceHeight, scale: s, format: 'png' }
}

/** 读取原图尺寸 */
export async function readSize(pngBuf) {
  const meta = await sharp(pngBuf).metadata()
  return { width: meta.width || 0, height: meta.height || 0 }
}

/** 精确读取某个像素（基于原始 PNG，无任何有损压缩误差） */
export async function readPixel(pngBuf, x, y) {
  const { width, height } = await readSize(pngBuf)
  const px = Math.max(0, Math.min(width - 1, Math.floor(x)))
  const py = Math.max(0, Math.min(height - 1, Math.floor(y)))
  const { data, info } = await sharp(pngBuf)
    .extract({ left: px, top: py, width: 1, height: 1 })
    .raw()
    .toBuffer({ resolveWithObject: true })
  const ch = info.channels
  const r = data[0]
  const g = ch > 1 ? data[1] : r
  const b = ch > 2 ? data[2] : r
  const a = ch > 3 ? data[3] : 255
  return { x: px, y: py, r, g, b, a, hex: toHex(r, g, b), decimal: toDecimal(r, g, b) }
}

/**
 * 全屏找色（与 AutoJs6 images.findColor 语义一致：逐通道容差判定）
 * threshold 为每通道允许的最大差值，默认 4
 */
export async function findColorOnFrame(pngBuf, options = {}) {
  const { color, threshold = 4, region = null, limit = 500, stride = 1 } = options
  const target = parseColor(color)
  const tol = Math.max(0, Math.min(255, Math.round(threshold)))
  const started = Date.now()

  const { data, info } = await sharp(pngBuf).raw().toBuffer({ resolveWithObject: true })
  const { width, height, channels } = info

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
    let idx = (y * width + rx) * channels
    for (let x = rx; x < rx + rw; x += step, idx += channels * step) {
      const dr = data[idx] - tr
      const dg = data[idx + 1] - tg
      const db = data[idx + 2] - tb
      if (
        (dr < 0 ? -dr : dr) <= tol &&
        (dg < 0 ? -dg : dg) <= tol &&
        (db < 0 ? -db : db) <= tol
      ) {
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
    color: toHex(tr, tg, tb),
    threshold: tol,
    region: { x: rx, y: ry, w: rw, h: rh },
    frame: { width, height },
    total,
    truncated: total > matches.length,
    matches,
    bbox:
      total > 0
        ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
        : null,
    elapsed: Date.now() - started,
  }
}

/**
 * 裁剪区域并导出 PNG（按设备原始像素 1:1 输出，不做缩放，不做有损压缩）
 * @param {{x:number,y:number,w:number,h:number}} region 设备坐标
 */
export async function cropRegion(pngBuf, region, { compressionLevel = 6 } = {}) {
  const meta = await sharp(pngBuf).metadata()
  const W = meta.width || 0
  const H = meta.height || 0

  let left = Math.max(0, Math.min(W - 1, Math.round(Number(region.x) || 0)))
  let top = Math.max(0, Math.min(H - 1, Math.round(Number(region.y) || 0)))
  let width = Math.max(1, Math.min(W - left, Math.round(Number(region.w ?? region.width) || 1)))
  let height = Math.max(1, Math.min(H - top, Math.round(Number(region.h ?? region.height) || 1)))

  const buffer = await sharp(pngBuf)
    .extract({ left, top, width, height })
    .png({ compressionLevel: Math.max(0, Math.min(9, Math.round(compressionLevel))) })
    .toBuffer()

  return { buffer, x: left, y: top, width, height, format: 'png' }
}

/** 把任意格式图片（png/jpg/webp…）归一化成 PNG（用于本地图片作为数据源） */
export async function normalizeImage(buf) {
  const meta = await sharp(buf).metadata()
  if (!meta.width || !meta.height) throw new Error('无法解析图片尺寸，可能不是有效图片')
  const png = meta.format === 'png' ? buf : await sharp(buf).png({ compressionLevel: 6 }).toBuffer()
  return {
    buffer: png,
    width: meta.width,
    height: meta.height,
    format: 'png',
    sourceFormat: meta.format || 'png',
  }
}

const DEMO_W = 1080
const DEMO_H = 1920

/** 演示模式：无真机时生成一张会动的模拟屏幕，便于完整体验工具能力 */
export function renderDemoFrame() {
  const now = new Date()
  const time = now.toLocaleTimeString('zh-CN', { hour12: false })
  const t = Date.now() / 1000
  const dotX = 120 + ((t * 120) % 840)
  const dotY = 1230 + Math.sin(t * 2) * 60
  const bars = Array.from({ length: 7 }, (_, i) => {
    const h = 60 + Math.abs(Math.sin(t * 1.6 + i)) * 180
    return `<rect x="${180 + i * 100}" y="${1420 - h}" width="56" height="${h}" rx="14" fill="#4C7CF3" opacity="${0.45 + i * 0.07}"/>`
  }).join('')

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${DEMO_W}" height="${DEMO_H}" viewBox="0 0 ${DEMO_W} ${DEMO_H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#101A2E"/><stop offset="100%" stop-color="#080D18"/>
    </linearGradient>
    <linearGradient id="hero" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#FF8A3D"/><stop offset="100%" stop-color="#FF5A1F"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <text x="72" y="120" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="38" fill="#6E7C96">演示模式 · 未连接真机</text>
  <text x="72" y="220" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="82" font-weight="700" fill="#F4F7FF">${time}</text>

  <rect x="72" y="300" width="936" height="250" rx="36" fill="url(#hero)"/>
  <text x="128" y="390" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="44" font-weight="700" fill="#FFFFFF">主按钮 #FF6B2C</text>
  <text x="128" y="456" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="30" fill="#FFE7D8">点击这里可以测试找色与取坐标</text>
  <rect x="128" y="486" width="200" height="46" rx="23" fill="#FFFFFF" opacity="0.9"/>

  <rect x="72" y="600" width="456" height="300" rx="32" fill="#12B5A5"/>
  <text x="116" y="700" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="38" font-weight="700" fill="#FFFFFF">青绿 #12B5A5</text>
  <rect x="116" y="740" width="180" height="120" rx="24" fill="#FFFFFF" opacity="0.16"/>

  <rect x="552" y="600" width="456" height="300" rx="32" fill="#7C5CFF"/>
  <text x="596" y="700" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="38" font-weight="700" fill="#FFFFFF">紫罗兰 #7C5CFF</text>
  <circle cx="680" cy="800" r="54" fill="#FF3B30"/>
  <text x="660" y="816" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="34" font-weight="700" fill="#FFFFFF">红</text>

  <rect x="72" y="950" width="936" height="240" rx="32" fill="#18233B"/>
  <text x="116" y="1030" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="32" fill="#9DB0D0">彩色图标区（找色测试）</text>
  ${['#F5C518', '#31C48D', '#E0245E', '#3B82F6', '#F97316'].map((c, i) => `<circle cx="${180 + i * 180}" cy="1110" r="46" fill="${c}"/>`).join('')}

  <circle cx="${dotX}" cy="${dotY}" r="26" fill="#FF3B30"/>
  <text x="${dotX + 40}" y="${dotY + 12}" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="26" fill="#FF6B5E">动态红点 #FF3B30</text>

  ${bars}
  <text x="72" y="1520" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="28" fill="#6E7C96">模拟分辨率 1080 × 1920 · 画面持续刷新以验证实时投屏</text>

  <rect x="72" y="1620" width="936" height="200" rx="28" fill="#0E1729" stroke="#233452" stroke-width="2"/>
  <text x="116" y="1700" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="30" fill="#8FA2C0">操作提示</text>
  <text x="116" y="1760" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="28" fill="#5E7091">框选区域 → 复制 [x, y, w, h]    ·    点击像素 → 复制锚点颜色</text>
</svg>`

  return sharp(Buffer.from(svg)).png().toBuffer()
}
