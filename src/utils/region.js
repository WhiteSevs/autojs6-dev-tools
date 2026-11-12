/**
 * 区域坐标的解析工具：把「手输 / 粘贴进来的坐标文本」还原成 { x, y, w, h }。
 *
 * 支持的形式（数字可带小数，全角标点会被自动纠正）：
 *   [100, 200, 300, 400]           100, 200, 300, 400
 *   100 200 300 400                （四种分隔符可混用）
 *   x=100 y=200 w=300 h=400        x: 100, y: 200, width: 300, height: 400
 *   left=100 top=200 width=300 height=400
 * 直接粘一整段脚本也能用：数字多于 4 个时按顺序取前 4 个。
 *
 * 只给 x / y 而没给宽高时，沿用当前区域的尺寸（相当于平移）；
 * 只给 w / h 时沿用当前位置（相当于改尺寸）。负的宽 / 高会自动折成正的。
 */

/** 全角标点 → 半角，避免从聊天工具 / 文档里粘出来解析失败 */
const FULLWIDTH = [
  [/[，、]/g, ','],
  [/[；]/g, ';'],
  [/[：]/g, ':'],
  [/[＝]/g, '='],
  [/[（]/g, '('],
  [/[）]/g, ')'],
  [/[［【]/g, '['],
  [/[］】]/g, ']'],
  [/[｛]/g, '{'],
  [/[｝]/g, '}'],
  [/[\u3000\u00a0]/g, ' '],
  [/[－—–−]/g, '-'],
]

export function normalizeRegionText(text) {
  let s = String(text ?? '')
  for (const [re, to] of FULLWIDTH) s = s.replace(re, to)
  // 全角数字（１２３）也折算成半角，中文输入法下很容易打出来
  s = s.replace(/[\uff10-\uff19]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
  return s.trim()
}

const NUMBER = /-?\d+(?:\.\d+)?/g

/** 标签别名：长的放前面，避免 width 被 w 抢先匹配 */
const LABELS = {
  x: ['left', 'startx', 'start_x', 'x'],
  y: ['top', 'starty', 'start_y', 'y'],
  w: ['width', 'w'],
  h: ['height', 'h'],
}

function readLabeled(text, keys) {
  for (const key of keys) {
    // 前面不能紧贴字母 / 数字 / 下划线，避免把 max= 里的 x 当成 x
    const re = new RegExp(`(?:^|[^a-z0-9_])${key}\\s*[:=]\\s*(-?\\d+(?:\\.\\d+)?)`, 'i')
    const m = text.match(re)
    if (m) return Number(m[1])
  }
  return null
}

function clampInt(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(value)))
}

/**
 * @param {string} text 用户输入 / 粘贴的文本
 * @param {object} opts
 * @param {number} [opts.width]  画布宽（设备物理像素），传 0 表示不裁剪
 * @param {number} [opts.height] 画布高
 * @param {{x:number,y:number,w:number,h:number}|null} [opts.current] 当前区域，缺省字段从这里继承
 * @returns {{ok:true, region:{x:number,y:number,w:number,h:number}, partial:boolean}
 *          | {ok:false, error:string}}
 */
export function parseRegion(text, { width = 0, height = 0, current = null } = {}) {
  const raw = normalizeRegionText(text)
  if (!raw) return { ok: false, error: '请先输入或粘贴坐标，例如 [100, 200, 300, 400]' }

  let x = readLabeled(raw, LABELS.x)
  let y = readLabeled(raw, LABELS.y)
  let w = readLabeled(raw, LABELS.w)
  let h = readLabeled(raw, LABELS.h)

  const labeled = [x, y, w, h].filter((v) => v != null).length

  if (labeled < 2) {
    // 没有成对的标签：按顺序取数字
    const nums = (raw.match(NUMBER) || []).map(Number)
    if (nums.length >= 4) {
      ;[x, y, w, h] = nums
    } else if (nums.length === 2) {
      ;[x, y] = nums
    } else if (nums.length === 3) {
      return { ok: false, error: '只识别到 3 个数字，需要 x / y / w / h 四项（或 x= y= w= h= 标签）' }
    } else if (nums.length <= 1) {
      return { ok: false, error: '没有识别到坐标数字，例如 [100, 200, 300, 400]' }
    }
  }

  const base = current && Number.isFinite(current.w) && Number.isFinite(current.h) ? current : null
  const partial = x != null && y != null && (w == null || h == null)

  if (x == null) x = base ? base.x : 0
  if (y == null) y = base ? base.y : 0
  if (w == null) w = base ? base.w : null
  if (h == null) h = base ? base.h : null

  if (w == null || h == null) {
    return {
      ok: false,
      error: '只有位置没有尺寸：请同时给出 w / h，或先框选一个区域再只输入 x / y 来平移',
    }
  }

  let nx = Math.round(x)
  let ny = Math.round(y)
  let nw = Math.round(w)
  let nh = Math.round(h)

  // 负宽高按「反方向框选」处理
  if (nw < 0) {
    nx += nw
    nw = -nw
  }
  if (nh < 0) {
    ny += nh
    nh = -nh
  }
  nw = Math.max(1, nw)
  nh = Math.max(1, nh)

  // 裁到画布范围内（没有画面尺寸时不裁）
  if (width > 0) {
    nx = clampInt(nx, 0, Math.max(0, width - 1))
    nw = Math.min(nw, Math.max(1, width - nx))
  }
  if (height > 0) {
    ny = clampInt(ny, 0, Math.max(0, height - 1))
    nh = Math.min(nh, Math.max(1, height - ny))
  }

  return { ok: true, region: { x: nx, y: ny, w: nw, h: nh }, partial }
}

/** 统一成 [x, y, w, h] 文本，用于回填输入框 / 提示 */
export function formatRegionText(region) {
  if (!region) return ''
  return `[${region.x}, ${region.y}, ${region.w}, ${region.h}]`
}
