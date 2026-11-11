/**
 * 区域框选模式下按 C 复制的「当前坐标」格式。
 * 本质就是 [x, y, w, h]：x / y 是光标位置，w / h 取自当前框选，
 * 没框选时为 0；Shift 切换只是去掉两侧方括号。
 */
export const COORD_FORMATS = [
  { key: 'bracket', label: '带括号', example: '[x, y, w, h]' },
  { key: 'plain', label: '不带括号', example: 'x, y, w, h' },
]

const KEYS = COORD_FORMATS.map((f) => f.key)

/** 兼容旧版本存过的 region / point */
const ALIAS = { region: 'bracket', point: 'plain' }

export function normalizeCoordFormat(fmt) {
  const key = ALIAS[fmt] || fmt
  return KEYS.includes(key) ? key : 'bracket'
}

export function nextCoordFormat(fmt) {
  const i = KEYS.indexOf(normalizeCoordFormat(fmt))
  return KEYS[(i + 1) % KEYS.length]
}

export function coordFormatLabel(fmt) {
  return COORD_FORMATS.find((f) => f.key === normalizeCoordFormat(fmt))?.label || '带括号'
}

export function coordFormatExample(fmt) {
  return COORD_FORMATS.find((f) => f.key === normalizeCoordFormat(fmt))?.example || '[x, y, w, h]'
}

/**
 * pt: 光标下的设备坐标 { x, y }
 * size: 当前框选尺寸 { w, h }，未框选传 null → 0
 */
export function formatCoord(pt, fmt = 'bracket', size = null) {
  if (!pt) return ''
  const x = Math.round(pt.x)
  const y = Math.round(pt.y)
  const w = Math.max(0, Math.round(size?.w || 0))
  const h = Math.max(0, Math.round(size?.h || 0))
  const nums = `${x}, ${y}, ${w}, ${h}`
  return normalizeCoordFormat(fmt) === 'plain' ? nums : `[${nums}]`
}
