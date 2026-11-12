/**
 * 区域框选模式下按 C 复制的坐标格式。
 * 本质就是 [x, y, w, h]：已框选时取框选区域（选区左上角 + 宽高），未框选时 x / y 取光标位置、w / h 为 0；
 * Shift 在「带括号 / 不带括号 / 自定义模板」之间循环。
 */
export const COORD_FORMATS = [
  { key: 'bracket', label: '带括号', example: '[x, y, w, h]' },
  { key: 'plain', label: '不带括号', example: 'x, y, w, h' },
  { key: 'custom', label: '自定义模板', example: '' },
]

/** 自定义模板里可用的占位符 */
export const COORD_PLACEHOLDERS = [
  { key: '${region}', desc: '[x, y, w, h]' },
  { key: '${x}', desc: 'X（已框选为区域 X，否则光标 X）' },
  { key: '${y}', desc: 'Y（已框选为区域 Y，否则光标 Y）' },
  { key: '${w}', desc: '框选宽度（未框选为 0）' },
  { key: '${h}', desc: '框选高度（未框选为 0）' },
]

/** 自定义模板默认留空，由用户自己写 */
export const DEFAULT_COORD_TEMPLATE = ''

/** 早期版本预置过的示例模板，读到它时按「未填写」处理，避免刷新后又冒出示例 */
const LEGACY_TEMPLATE = 'return CommonUtil.regionConversion(${region});'

export function normalizeCoordTemplate(tpl) {
  const v = String(tpl ?? '')
  return v.trim() === LEGACY_TEMPLATE ? DEFAULT_COORD_TEMPLATE : v
}

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

export function coordFormatExample(fmt, template = '') {
  const key = normalizeCoordFormat(fmt)
  if (key === 'custom') return String(template || '').trim().replace(/\s+/g, ' ')
  return COORD_FORMATS.find((f) => f.key === key)?.example || '[x, y, w, h]'
}

/** 纯字符串替换，不执行用户模板，避免任何注入风险 */
function applyTemplate(tpl, v) {
  return String(tpl)
    .replace(/\$\{region\}/g, `[${v.x}, ${v.y}, ${v.w}, ${v.h}]`)
    .replace(/\$\{x\}/g, String(v.x))
    .replace(/\$\{y\}/g, String(v.y))
    .replace(/\$\{w\}/g, String(v.w))
    .replace(/\$\{h\}/g, String(v.h))
}

/**
 * pt: 要复制的坐标点 { x, y } —— 有框选时是选区左上角，没框选时是光标下的坐标
 * size: 当前框选尺寸 { w, h }，未框选传 null → 0
 * template: 自定义格式的模板字符串（仅在 fmt = custom 时生效）
 */
export function formatCoord(pt, fmt = 'bracket', size = null, template = '') {
  if (!pt) return ''
  const x = Math.round(pt.x)
  const y = Math.round(pt.y)
  const w = Math.max(0, Math.round(size?.w || 0))
  const h = Math.max(0, Math.round(size?.h || 0))
  const key = normalizeCoordFormat(fmt)

  if (key === 'custom') {
    const tpl = String(template || '').trim()
    // 模板为空就输出空字符串，由调用方提示用户去填
    if (!tpl) return ''
    return applyTemplate(tpl, { x, y, w, h })
  }

  const nums = `${x}, ${y}, ${w}, ${h}`
  return key === 'plain' ? nums : `[${nums}]`
}
