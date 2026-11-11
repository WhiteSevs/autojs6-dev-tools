/**
 * 颜色格式工具：锚点取色里按 C 复制的文本由这里统一生成，
 * 保证画面标注、侧栏读数、剪贴板内容三者始终一致。
 */

/** 支持的格式（Shift 循环切换，默认 hex） */
export const COLOR_FORMATS = [
  { key: 'hex', label: 'HEX', example: '#ffffff' },
  { key: 'rgb', label: 'RGB', example: 'rgb(255, 255, 255)' },
  { key: 'int', label: '整数', example: '0xffffff' },
]

const KEYS = COLOR_FORMATS.map((f) => f.key)

export function normalizeFormat(fmt) {
  return KEYS.includes(fmt) ? fmt : 'hex'
}

export function nextFormat(fmt) {
  const i = KEYS.indexOf(normalizeFormat(fmt))
  return KEYS[(i + 1) % KEYS.length]
}

export function formatLabel(fmt) {
  return COLOR_FORMATS.find((f) => f.key === normalizeFormat(fmt))?.label || 'HEX'
}

export function formatExample(fmt) {
  return COLOR_FORMATS.find((f) => f.key === normalizeFormat(fmt))?.example || '#ffffff'
}

function clamp(v) {
  return Math.max(0, Math.min(255, Math.round(v)))
}

/** 从 { r, g, b } / { hex } / "#RRGGBB" 解析通道值；非法返回 null */
export function toRgb(color) {
  if (!color) return null
  if (typeof color === 'object') {
    const { r, g, b } = color
    if ([r, g, b].every((v) => Number.isFinite(Number(v)))) {
      return { r: clamp(r), g: clamp(g), b: clamp(b) }
    }
    return toRgb(color.hex)
  }
  let hex = String(color).trim().replace(/^#/, '')
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('')
  }
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null
  const num = parseInt(hex, 16)
  return { r: (num >> 16) & 0xff, g: (num >> 8) & 0xff, b: num & 0xff }
}

/** 统一输出小写 #rrggbb，便于直接粘贴进脚本 */
export function toHex(color) {
  const rgb = toRgb(color)
  if (!rgb) return ''
  return '#' + [rgb.r, rgb.g, rgb.b].map((v) => v.toString(16).padStart(2, '0')).join('')
}

export function formatColor(color, fmt = 'hex') {
  const rgb = toRgb(color)
  if (!rgb) return ''
  const parts = [rgb.r, rgb.g, rgb.b].map((v) => v.toString(16).padStart(2, '0')).join('')
  switch (normalizeFormat(fmt)) {
    case 'rgb':
      return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`
    case 'int':
      return `0x${parts}`
    default:
      return `#${parts}`
  }
}
