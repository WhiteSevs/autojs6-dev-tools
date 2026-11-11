<template>
  <div ref="stageRef" class="stage" :class="[`mode-${mode}`, { dragging: !!drag, 'picking-offset': offsetPicking }]">
    <canvas
      ref="canvasRef"
      class="stage-canvas"
      tabindex="0"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointerleave="onPointerLeave"
      @wheel="onWheel"
      @mousedown.right.prevent
      @mousedown.middle.prevent
      @contextmenu.prevent
      @auxclick.prevent
      @keydown="onKeyDown"
    />

    <!-- 工具栏显隐（常驻，隐藏后仍可恢复） -->
    <el-tooltip
      :content="showToolbar ? '隐藏画面工具栏（T）' : '显示画面工具栏（T）'"
      placement="right"
    >
      <button class="overlay-toggle" :class="{ off: !showToolbar }" @click="$emit('update:showToolbar', !showToolbar)">
        <el-icon><component :is="showToolbar ? 'Hide' : 'View'" /></el-icon>
      </button>
    </el-tooltip>

    <!-- 模式切换 -->
    <div v-if="showToolbar" class="stage-tools">
      <div class="seg">
        <button :class="{ active: mode === 'region' }" @click="$emit('update:mode', 'region')">
          <el-icon><Crop /></el-icon> 区域框选
        </button>
        <button :class="{ active: mode === 'color' }" @click="$emit('update:mode', 'color')">
          <el-icon><Aim /></el-icon> 锚点取色
        </button>
      </div>
      <div class="tool-sep" />
      <el-tooltip content="显示坐标网格（G）" placement="bottom">
        <button class="icon-btn" :class="{ active: showGrid }" @click="toggleGrid">
          <el-icon><Grid /></el-icon>
        </button>
      </el-tooltip>
      <el-tooltip
        v-if="mode === 'region' && region"
        content="从区域中心添加偏移点（P）：取画面其它位置相对中心点的偏移量"
        placement="bottom"
      >
        <button
          class="icon-btn"
          :class="{ active: offsetPicking }"
          @click="$emit('update:offsetPicking', !offsetPicking)"
        >
          <el-icon><Pointer /></el-icon>
        </button>
      </el-tooltip>
      <el-tooltip content="缩小（-）" placement="bottom">
        <button class="icon-btn" @click="zoomBy(1 / 1.25)"><el-icon><ZoomOut /></el-icon></button>
      </el-tooltip>
      <el-tooltip content="点击回到适应屏幕（0）" placement="bottom">
        <button class="zoom-label mono" @click="resetZoom">{{ Math.round(scale * 100) }}%</button>
      </el-tooltip>
      <el-tooltip content="放大（+ / Ctrl + 滚轮）" placement="bottom">
        <button class="icon-btn" @click="zoomBy(1.25)"><el-icon><ZoomIn /></el-icon></button>
      </el-tooltip>
      <div class="tool-sep" />
      <el-tooltip content="1:1 显示设备像素，看清每个像素（同时切到原画传输）" placement="bottom">
        <button class="preset-btn" :class="{ active: isActualSize }" @click="zoomToActual">原画 1:1</button>
      </el-tooltip>
      <div class="tool-sep" />
      <el-tooltip content="移动画面（H）：开启后左键拖拽即平移；也可直接按住鼠标右键拖动" placement="bottom">
        <button class="icon-btn" :class="{ active: panMode }" @click="$emit('update:panMode', !panMode)">
          <el-icon><Rank /></el-icon>
        </button>
      </el-tooltip>
    </div>

    <!-- 冻结提示 -->
    <transition name="fade">
      <button v-if="frozen" class="freeze-badge" @click="$emit('resume')">
        <el-icon><VideoPause /></el-icon>
        <span>画面已冻结 · 点击恢复实时</span>
      </button>
    </transition>

    <!-- 空状态 -->
    <div v-if="!bitmap" class="stage-empty">
      <el-icon class="empty-icon"><Monitor /></el-icon>
      <p>{{ emptyTitle }}</p>
      <span>{{ emptyDesc }}</span>
    </div>

    <!-- 底部操作提示 -->
    <div v-if="showToolbar" class="stage-hint">
      <template v-if="mode === 'region'">
        <template v-if="offsetPicking">
          <span><b>点击</b>画面取点，得到相对区域中心的偏移量</span>
          <span class="dot">·</span>
          <span>可连续点多个位置</span>
          <span class="dot">·</span>
          <span><span class="kbd">Esc</span> / <span class="kbd">P</span> 结束取点</span>
        </template>
        <template v-else>
          <span><b>拖拽</b>框选区域</span>
          <span class="dot">·</span>
          <span>框内拖动可整体移动，拖动<b>边角</b>缩放</span>
          <span class="dot">·</span>
          <span><span class="kbd">↑↓←→</span> 微调 1px，<span class="kbd">Shift</span> 10px</span>
          <span class="dot">·</span>
          <span><span class="kbd">Ctrl</span>+<span class="kbd">S</span> 保存 / <span class="kbd">Ctrl</span>+<span class="kbd">C</span> 复制{{ region ? '区域图' : '整屏' }}</span>
        </template>
      </template>
      <template v-else>
        <span><b>移动</b>查看放大镜，<b>单击</b>拾取锚点颜色</span>
        <span class="dot">·</span>
        <span><span class="kbd">+</span><span class="kbd">-</span> 缩放，<b>右键拖动</b>或 <span class="kbd">H</span> 平移</span>
        <span class="dot">·</span>
        <span><span class="kbd">Ctrl</span>+<span class="kbd">S</span> 保存 / <span class="kbd">Ctrl</span>+<span class="kbd">C</span> 复制{{ region ? '区域图' : '整屏' }}</span>
      </template>
    </div>

    <!-- 坐标读数 -->
    <div v-if="showToolbar && hoverDev" class="coord-readout mono">
      <span class="c-label">X</span>{{ hoverDev.x }}
      <span class="c-label">Y</span>{{ hoverDev.y }}
      <template v-if="hoverColor">
        <i class="swatch" :style="{ background: hoverColor }" />
        <span class="c-hex">{{ hoverColor }}</span>
      </template>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  bitmap: { type: Object, default: null },
  meta: { type: Object, default: null },
  mode: { type: String, default: 'region' },
  region: { type: Object, default: null },
  offsets: { type: Array, default: () => [] },
  offsetPicking: { type: Boolean, default: false },
  anchor: { type: Object, default: null },
  matches: { type: Array, default: () => [] },
  matchTotal: { type: Number, default: 0 },
  bbox: { type: Object, default: null },
  frozen: { type: Boolean, default: false },
  panMode: { type: Boolean, default: false },
  showToolbar: { type: Boolean, default: true },
  emptyTitle: { type: String, default: '等待画面…' },
  emptyDesc: { type: String, default: '正在连接设备并拉取屏幕，稍候片刻' },
})

const emit = defineEmits([
  'update:mode',
  'update:panMode',
  'update:region',
  'update:offsetPicking',
  'update:showToolbar',
  'pick',
  'pick-offset',
  'interact',
  'resume',
  'hover',
  'request-original',
])

const stageRef = ref(null)
const canvasRef = ref(null)
const showGrid = ref(false)

const viewport = ref({ w: 0, h: 0 })
const zoom = ref(1)
const pan = ref({ x: 0, y: 0 })
const hoverDev = ref(null)
const hoverColor = ref('')
const drag = ref(null)
const spaceDown = ref(false)

let ctx = null
let sourceCanvas = null
let rafId = 0
let dpr = window.devicePixelRatio || 1

const PAD = 26
const MIN_ZOOM = 0.4
const MAX_ZOOM = 16

const deviceW = computed(() => props.meta?.deviceWidth || 0)
const deviceH = computed(() => props.meta?.deviceHeight || 0)
const frameScale = computed(() => props.meta?.scale || 1)

const fitScale = computed(() => {
  if (!deviceW.value || !deviceH.value || !viewport.value.w) return 1
  const sx = (viewport.value.w - PAD * 2) / deviceW.value
  const sy = (viewport.value.h - PAD * 2) / deviceH.value
  return Math.max(0.02, Math.min(sx, sy))
})

const scale = computed(() => fitScale.value * zoom.value)

const isActualSize = computed(() => scale.value >= 0.999 && scale.value <= 1.001)

const origin = computed(() => {
  const dw = deviceW.value * scale.value
  const dh = deviceH.value * scale.value
  return {
    x: (viewport.value.w - dw) / 2 + pan.value.x,
    y: (viewport.value.h - dh) / 2 + pan.value.y,
    dw,
    dh,
  }
})

function devToScreen(x, y) {
  const o = origin.value
  return [o.x + x * scale.value, o.y + y * scale.value]
}

function screenToDev(sx, sy) {
  const o = origin.value
  return {
    x: Math.max(0, Math.min(deviceW.value - 1, (sx - o.x) / scale.value)),
    y: Math.max(0, Math.min(deviceH.value - 1, (sy - o.y) / scale.value)),
  }
}

/* ------------------------------ 尺寸与重绘 ------------------------------ */
function resize() {
  const el = stageRef.value
  const canvas = canvasRef.value
  if (!el || !canvas) return
  const rect = el.getBoundingClientRect()
  dpr = window.devicePixelRatio || 1
  viewport.value = { w: rect.width, h: rect.height }
  canvas.width = Math.round(rect.width * dpr)
  canvas.height = Math.round(rect.height * dpr)
  canvas.style.width = `${rect.width}px`
  canvas.style.height = `${rect.height}px`
  ctx = canvas.getContext('2d')
  schedule()
}

function schedule() {
  if (rafId) return
  rafId = requestAnimationFrame(() => {
    rafId = 0
    render()
  })
}

function rebuildSource() {
  if (!props.bitmap || !props.meta) {
    sourceCanvas = null
    return
  }
  const w = props.meta.width
  const h = props.meta.height
  if (!sourceCanvas) sourceCanvas = document.createElement('canvas')
  sourceCanvas.width = w
  sourceCanvas.height = h
  const sctx = sourceCanvas.getContext('2d', { willReadFrequently: true })
  sctx.clearRect(0, 0, w, h)
  sctx.drawImage(props.bitmap, 0, 0, w, h)
}

/* ------------------------------ 绘制 ------------------------------ */
function roundRect(c, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2)
  c.beginPath()
  c.moveTo(x + rr, y)
  c.arcTo(x + w, y, x + w, y + h, rr)
  c.arcTo(x + w, y + h, x, y + h, rr)
  c.arcTo(x, y + h, x, y, rr)
  c.arcTo(x, y, x + w, y, rr)
  c.closePath()
}

function drawChip(x, y, text, opts = {}) {
  const { bg = 'rgba(13,20,34,0.9)', color = '#E8F6F5', align = 'left', font = 11.5 } = opts
  ctx.font = `600 ${font}px 'Cascadia Code', Consolas, monospace`
  const tw = ctx.measureText(text).width
  const padX = 7
  const h = 20
  const w = tw + padX * 2
  let bx = align === 'right' ? x - w : x
  bx = Math.max(4, Math.min(viewport.value.w - w - 4, bx))
  const by = Math.max(4, Math.min(viewport.value.h - h - 4, y))
  ctx.fillStyle = bg
  roundRect(ctx, bx, by, w, h, 6)
  ctx.fill()
  ctx.fillStyle = color
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillText(text, bx + padX, by + h / 2 + 0.5)
  return { x: bx, y: by, w, h }
}

function render() {
  const canvas = canvasRef.value
  if (!canvas || !ctx) return
  const { w: cw, h: ch } = viewport.value
  if (!cw || !ch) return

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cw, ch)

  if (!props.bitmap || !props.meta) return

  const o = origin.value

  // 设备外框阴影
  ctx.save()
  ctx.shadowColor = 'rgba(15,23,42,0.22)'
  ctx.shadowBlur = 22
  ctx.shadowOffsetY = 6
  ctx.fillStyle = '#ffffff'
  roundRect(ctx, o.x - 1, o.y - 1, o.dw + 2, o.dh + 2, 8)
  ctx.fill()
  ctx.restore()

  ctx.imageSmoothingEnabled = zoom.value <= 1.5
  ctx.drawImage(props.bitmap, o.x, o.y, o.dw, o.dh)
  ctx.imageSmoothingEnabled = true

  ctx.strokeStyle = 'rgba(15,23,42,0.16)'
  ctx.lineWidth = 1
  ctx.strokeRect(o.x - 0.5, o.y - 0.5, o.dw + 1, o.dh + 1)

  if (showGrid.value) drawGrid(o)

  if (props.region) drawRegion(props.region, !props.offsetPicking)
  if (props.region && props.offsets?.length) drawOffsets(props.region, props.offsets)
  if (props.region && props.offsetPicking) drawPickPreview(props.region)
  if (props.matches?.length) drawMatches()
  if (props.anchor) drawAnchor(props.anchor)

  if (props.mode === 'color' && hoverDev.value) drawLoupe()

  // 取点时也要十字线：此时画面常被冻结，但取点仍需要精确对位
  if (props.mode === 'region' && (props.offsetPicking || (!props.region && !props.frozen))) drawCrosshair()
}

function drawGrid(o) {
  const stepDev = 100
  const s = scale.value
  if (stepDev * s < 14) return
  ctx.save()
  ctx.strokeStyle = 'rgba(14,165,160,0.16)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = stepDev; x < deviceW.value; x += stepDev) {
    const [sx] = devToScreen(x, 0)
    ctx.moveTo(sx, o.y)
    ctx.lineTo(sx, o.y + o.dh)
  }
  for (let y = stepDev; y < deviceH.value; y += stepDev) {
    const [, sy] = devToScreen(0, y)
    ctx.moveTo(o.x, sy)
    ctx.lineTo(o.x + o.dw, sy)
  }
  ctx.stroke()

  ctx.fillStyle = 'rgba(14,165,160,0.95)'
  ctx.font = "600 10px 'Cascadia Code', Consolas, monospace"
  ctx.textBaseline = 'bottom'
  const labelStep = stepDev * Math.max(1, Math.ceil(80 / (stepDev * s)))
  for (let x = labelStep; x < deviceW.value; x += labelStep) {
    const [sx] = devToScreen(x, 0)
    ctx.textAlign = 'center'
    ctx.fillText(String(x), sx, o.y - 4)
  }
  ctx.textAlign = 'right'
  for (let y = labelStep; y < deviceH.value; y += labelStep) {
    const [, sy] = devToScreen(0, y)
    ctx.fillText(String(y), o.x - 5, sy + 4)
  }
  ctx.restore()
}

function drawRegion(region, dim = true) {
  const [x1, y1] = devToScreen(region.x, region.y)
  const w = region.w * scale.value
  const h = region.h * scale.value

  // 取点时取消区域外压暗，方便看清并精确点选区域外的位置
  if (dim) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(origin.value.x, origin.value.y, origin.value.dw, origin.value.dh)
    ctx.rect(x1, y1, w, h)
    ctx.fillStyle = 'rgba(8,15,30,0.42)'
    ctx.fill('evenodd')
    ctx.restore()
  }

  ctx.save()
  ctx.strokeStyle = '#0EA5A0'
  ctx.lineWidth = 1.6
  ctx.strokeRect(x1 + 0.5, y1 + 0.5, w - 1, h - 1)
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  ctx.strokeRect(x1 + 0.5, y1 + 0.5, w - 1, h - 1)
  ctx.restore()

  // 尺寸标签
  const sizeText = `${region.w} × ${region.h}`
  drawChip(x1 + w / 2 - 26, y1 + h / 2 - 10, sizeText, { bg: 'rgba(14,165,160,0.94)', color: '#fff' })

  // 坐标标签
  const coordText = `x ${region.x}  y ${region.y}`
  ctx.font = "600 11.5px 'Cascadia Code', Consolas, monospace"
  const tw = ctx.measureText(coordText).width + 14
  drawChip(x1, y1 - 25 >= 2 ? y1 - 25 : y1 + 4, coordText, { align: 'left' })
  if (tw > w + 30 && w < 90) {
    // 区域过窄时把坐标放到右侧，避免遮挡
  }

  // 中心点
  const [cx, cy] = devToScreen(region.x + region.w / 2, region.y + region.h / 2)
  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'
  ctx.lineWidth = 1.4
  ctx.beginPath()
  ctx.arc(cx, cy, 5, 0, Math.PI * 2)
  ctx.moveTo(cx - 8, cy)
  ctx.lineTo(cx + 8, cy)
  ctx.moveTo(cx, cy - 8)
  ctx.lineTo(cx, cy + 8)
  ctx.stroke()
  ctx.restore()

  // 八个控制点
  const handles = handlePositions(region)
  ctx.save()
  for (const hd of handles) {
    const [hx, hy] = devToScreen(hd.x, hd.y)
    ctx.fillStyle = '#ffffff'
    ctx.strokeStyle = '#0EA5A0'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.rect(hx - 4, hy - 4, 8, 8)
    ctx.fill()
    ctx.stroke()
  }
  ctx.restore()
}

/** 相对区域中心的偏移点：从中心拉一条虚线到目标点，标注 Δx / Δy */
function drawOffsets(region, list) {
  const cx = region.x + region.w / 2
  const cy = region.y + region.h / 2
  const [ox, oy] = devToScreen(cx, cy)

  // 原点（区域中心）外圈，表明偏移的计量起点
  ctx.save()
  ctx.strokeStyle = 'rgba(124,58,237,0.85)'
  ctx.lineWidth = 1.5
  ctx.setLineDash([3, 3])
  ctx.beginPath()
  ctx.arc(ox, oy, 11, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()

  list.forEach((p, i) => {
    const [sx, sy] = devToScreen(cx + p.dx, cy + p.dy)

    ctx.save()
    ctx.strokeStyle = 'rgba(124,58,237,0.7)'
    ctx.lineWidth = 1.2
    ctx.setLineDash([5, 4])
    ctx.beginPath()
    ctx.moveTo(ox, oy)
    ctx.lineTo(sx, sy)
    ctx.stroke()
    ctx.restore()

    ctx.save()
    ctx.strokeStyle = '#7C3AED'
    ctx.fillStyle = 'rgba(255,255,255,0.94)'
    ctx.lineWidth = 1.6
    ctx.beginPath()
    ctx.arc(sx, sy, 6, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(sx - 10, sy)
    ctx.lineTo(sx + 10, sy)
    ctx.moveTo(sx, sy - 10)
    ctx.lineTo(sx, sy + 10)
    ctx.stroke()
    ctx.restore()

    const label = `P${i + 1}  Δ${signed(p.dx)}, ${signed(p.dy)}`
    drawChip(sx + 12, sy - 26 >= 4 ? sy - 26 : sy + 12, label, { bg: 'rgba(109,40,217,0.94)', color: '#fff' })
  })
}

/** 取点过程中的实时预览：中心 → 光标 */
function drawPickPreview(region) {
  if (!hoverDev.value) return
  const cx = region.x + region.w / 2
  const cy = region.y + region.h / 2
  const [ox, oy] = devToScreen(cx, cy)
  const [sx, sy] = devToScreen(hoverDev.value.x + 0.5, hoverDev.value.y + 0.5)
  const dx = hoverDev.value.x - Math.round(cx)
  const dy = hoverDev.value.y - Math.round(cy)

  ctx.save()
  ctx.strokeStyle = 'rgba(124,58,237,0.9)'
  ctx.lineWidth = 1.4
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  ctx.moveTo(ox, oy)
  ctx.lineTo(sx, sy)
  ctx.stroke()
  ctx.restore()

  // 光标正好压在已有点上时不再叠一个数值气泡，避免两个标签打架
  const tooClose = props.offsets.some((p) => Math.abs(p.dx - dx) < 8 && Math.abs(p.dy - dy) < 8)
  if (tooClose) return

  drawChip(sx + 12, sy + 12, `Δ${signed(dx)}, ${signed(dy)}`, { bg: 'rgba(109,40,217,0.92)', color: '#fff' })
}

function signed(v) {
  return v > 0 ? `+${v}` : String(v)
}

function handlePositions(r) {
  const { x, y, w, h } = r
  const cx = x + w / 2
  const cy = y + h / 2
  return [
    { name: 'nw', x, y },
    { name: 'n', x: cx, y },
    { name: 'ne', x: x + w, y },
    { name: 'e', x: x + w, y: cy },
    { name: 'se', x: x + w, y: y + h },
    { name: 's', x: cx, y: y + h },
    { name: 'sw', x, y: y + h },
    { name: 'w', x, y: cy },
  ]
}

function drawMatches() {
  const list = props.matches
  const max = 260
  const count = Math.min(list.length, max)
  ctx.save()
  for (let i = 0; i < count; i++) {
    const m = list[i]
    const [sx, sy] = devToScreen(m.x, m.y)
    if (sx < -10 || sy < -10 || sx > viewport.value.w + 10 || sy > viewport.value.h + 10) continue
    const first = i === 0
    ctx.strokeStyle = first ? '#F97316' : 'rgba(14,165,160,0.85)'
    ctx.lineWidth = first ? 1.8 : 1
    const r = first ? 9 : 5
    ctx.beginPath()
    ctx.arc(sx, sy, r, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(sx - r - 3, sy)
    ctx.lineTo(sx + r + 3, sy)
    ctx.moveTo(sx, sy - r - 3)
    ctx.lineTo(sx, sy + r + 3)
    ctx.stroke()
  }
  ctx.restore()

  if (props.bbox) {
    const [bx, by] = devToScreen(props.bbox.x, props.bbox.y)
    ctx.save()
    ctx.strokeStyle = 'rgba(249,115,22,0.9)'
    ctx.lineWidth = 1.4
    ctx.setLineDash([6, 4])
    ctx.strokeRect(bx, by, props.bbox.w * scale.value, props.bbox.h * scale.value)
    ctx.restore()
    if (list.length) {
      const total = props.matchTotal || list.length
      drawChip(bx, by - 24 >= 2 ? by - 24 : by + 4, `命中 ${total} 处 · 首个 ${list[0].x},${list[0].y}`, {
        bg: 'rgba(249,115,22,0.95)',
        color: '#fff',
      })
    }
  }
}

function drawAnchor(anchor) {
  const [ax, ay] = devToScreen(anchor.x + 0.5, anchor.y + 0.5)
  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'
  ctx.lineWidth = 1
  ctx.setLineDash([3, 3])
  ctx.beginPath()
  ctx.moveTo(origin.value.x, ay)
  ctx.lineTo(origin.value.x + origin.value.dw, ay)
  ctx.moveTo(ax, origin.value.y)
  ctx.lineTo(ax, origin.value.y + origin.value.dh)
  ctx.stroke()
  ctx.setLineDash([])

  ctx.strokeStyle = '#FF3B30'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(ax, ay, 7, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = '#FF3B30'
  ctx.beginPath()
  ctx.arc(ax, ay, 2, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  const label = `(${anchor.x}, ${anchor.y})  ${anchor.hex || ''}`
  drawChip(ax + 12, ay - 26 >= 4 ? ay - 26 : ay + 12, label, { bg: 'rgba(220,38,38,0.95)', color: '#fff' })
}

function drawCrosshair() {
  if (!hoverDev.value) return
  const [sx, sy] = devToScreen(hoverDev.value.x, hoverDev.value.y)
  ctx.save()
  ctx.strokeStyle = 'rgba(14,165,160,0.55)'
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  ctx.moveTo(origin.value.x, sy)
  ctx.lineTo(origin.value.x + origin.value.dw, sy)
  ctx.moveTo(sx, origin.value.y)
  ctx.lineTo(sx, origin.value.y + origin.value.dh)
  ctx.stroke()
  ctx.restore()
}

function drawLoupe() {
  if (!sourceCanvas || !props.meta) return
  const bScale = frameScale.value
  const bmpW = props.meta.width
  const bmpH = props.meta.height
  const bx = Math.floor(hoverDev.value.x / bScale)
  const by = Math.floor(hoverDev.value.y / bScale)

  const cells = 11
  const cellSize = 10
  const size = cells * cellSize
  const half = (cells - 1) / 2

  const [sx, sy] = devToScreen(hoverDev.value.x, hoverDev.value.y)
  let lx = sx + 22
  let ly = sy + 22
  if (lx + size > viewport.value.w - 8) lx = sx - size - 22
  if (ly + size + 24 > viewport.value.h - 8) ly = sy - size - 24 - 22
  if (lx < 8) lx = 8
  if (ly < 8) ly = 8

  const sxStart = Math.max(0, bx - half)
  const syStart = Math.max(0, by - half)
  const w = Math.min(bmpW - sxStart, cells)
  const h = Math.min(bmpH - syStart, cells)

  ctx.save()
  ctx.shadowColor = 'rgba(15,23,42,0.35)'
  ctx.shadowBlur = 14
  ctx.fillStyle = '#0b1220'
  roundRect(ctx, lx - 5, ly - 5, size + 10, size + 10, 8)
  ctx.fill()
  ctx.restore()

  ctx.save()
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(sourceCanvas, sxStart, syStart, w, h, lx, ly, w * cellSize, h * cellSize)

  // 网格
  ctx.strokeStyle = 'rgba(148,163,184,0.22)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 1; i < cells; i++) {
    ctx.moveTo(lx + i * cellSize, ly)
    ctx.lineTo(lx + i * cellSize, ly + size)
    ctx.moveTo(lx, ly + i * cellSize)
    ctx.lineTo(lx + size, ly + i * cellSize)
  }
  ctx.stroke()

  // 中心像素高亮
  const cx = lx + (bx - sxStart) * cellSize
  const cy = ly + (by - syStart) * cellSize
  ctx.strokeStyle = '#FF3B30'
  ctx.lineWidth = 2
  ctx.strokeRect(cx - 0.5, cy - 0.5, cellSize + 1, cellSize + 1)
  ctx.restore()

  const colorText = hoverColor.value || '#——'
  const [dr, dg, db] = hexToRgb(colorText)
  const label = `${colorText}  ${dr},${dg},${db}`
  ctx.font = "600 11px 'Cascadia Code', Consolas, monospace"
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  const labelW = Math.max(size, ctx.measureText(label).width + 34)
  const barY = ly + size + 8

  ctx.save()
  ctx.shadowColor = 'rgba(15,23,42,0.3)'
  ctx.shadowBlur = 10
  ctx.fillStyle = '#0b1220'
  roundRect(ctx, lx - 5, barY - 4, labelW + 10, 26, 7)
  ctx.fill()
  ctx.restore()

  ctx.fillStyle = '#e2e8f0'
  // 色块
  ctx.fillStyle = colorText.startsWith('#') ? colorText : '#334155'
  roundRect(ctx, lx + 3, barY + 2, 14, 14, 3)
  ctx.fill()

  ctx.fillStyle = '#e2e8f0'
  ctx.fillText(label, lx + 23, barY + 9.5)
}

function hexToRgb(hex) {
  if (!hex || !hex.startsWith('#')) return [0, 0, 0]
  const num = parseInt(hex.slice(1), 16)
  return [(num >> 16) & 0xff, (num >> 8) & 0xff, num & 0xff]
}

/* ------------------------------ 交互 ------------------------------ */
function canvasPoint(ev) {
  const rect = canvasRef.value.getBoundingClientRect()
  return { x: ev.clientX - rect.left, y: ev.clientY - rect.top }
}

function pickHoverColor(devPt) {
  if (!sourceCanvas || !props.meta) return ''
  const bScale = frameScale.value
  const px = Math.floor(devPt.x / bScale)
  const py = Math.floor(devPt.y / bScale)
  if (px < 0 || py < 0 || px >= props.meta.width || py >= props.meta.height) return ''
  try {
    const d = sourceCanvas.getContext('2d', { willReadFrequently: true }).getImageData(px, py, 1, 1).data
    return '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()
  } catch {
    return ''
  }
}

function hitHandle(sx, sy) {
  if (!props.region) return null
  for (const hd of handlePositions(props.region)) {
    const [hx, hy] = devToScreen(hd.x, hd.y)
    if (Math.abs(hx - sx) <= 7 && Math.abs(hy - sy) <= 7) return hd.name
  }
  return null
}

function insideRegion(devPt) {
  const r = props.region
  if (!r) return false
  return devPt.x >= r.x && devPt.x <= r.x + r.w && devPt.y >= r.y && devPt.y <= r.y + r.h
}

function clampPanValue(x, y) {
  const dw = deviceW.value * scale.value
  const dh = deviceH.value * scale.value
  const maxX = Math.max(0, (dw - viewport.value.w) / 2)
  const maxY = Math.max(0, (dh - viewport.value.h) / 2)
  return {
    x: Math.max(-maxX, Math.min(maxX, x)),
    y: Math.max(-maxY, Math.min(maxY, y)),
  }
}

function onPointerDown(ev) {
  canvasRef.value.focus()
  const pt = canvasPoint(ev)
  const dev = screenToDev(pt.x, pt.y)

  // 平移：鼠标右键 / 中键 / Alt / 空格 / 「移动画面」开关
  if (ev.button === 2 || ev.button === 1 || props.panMode || ev.altKey || spaceDown.value) {
    ev.preventDefault()
    drag.value = { type: 'pan', startClient: { x: ev.clientX, y: ev.clientY }, startPan: { ...pan.value } }
    canvasRef.value.style.cursor = 'grabbing'
    canvasRef.value.setPointerCapture(ev.pointerId)
    return
  }
  if (ev.button !== 0) return

  if (props.mode === 'color') {
    emit('interact')
    emit('pick', { x: Math.floor(dev.x), y: Math.floor(dev.y) })
    return
  }

  // 取点模式：点击只记录相对中心的偏移，不改动区域本身
  if (props.mode === 'region' && props.offsetPicking) {
    emit('interact')
    emit('pick-offset', { x: Math.round(dev.x), y: Math.round(dev.y) })
    return
  }

  emit('interact')
  const sx = pt.x
  const sy = pt.y
  const handle = hitHandle(sx, sy)

  if (handle) {
    drag.value = { type: 'resize', handle, startRegion: { ...props.region } }
  } else if (insideRegion(dev)) {
    drag.value = { type: 'move', startDev: dev, startRegion: { ...props.region } }
  } else {
    drag.value = { type: 'new', startDev: dev }
    emit('update:region', null)
  }
  canvasRef.value.setPointerCapture(ev.pointerId)
}

function onPointerMove(ev) {
  const pt = canvasPoint(ev)
  const dev = screenToDev(pt.x, pt.y)
  hoverDev.value = { x: Math.floor(dev.x), y: Math.floor(dev.y) }
  emit('hover', hoverDev.value)
  if (props.mode === 'color') hoverColor.value = pickHoverColor(hoverDev.value)

  const d = drag.value
  if (d) {
    if (d.type === 'pan') {
      pan.value = clampPanValue(
        d.startPan.x + (ev.clientX - d.startClient.x),
        d.startPan.y + (ev.clientY - d.startClient.y),
      )
      schedule()
      return
    }
    if (d.type === 'new') {
      const x1 = Math.floor(d.startDev.x)
      const y1 = Math.floor(d.startDev.y)
      const x2 = Math.floor(dev.x)
      const y2 = Math.floor(dev.y)
      emit('update:region', {
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        w: Math.max(1, Math.abs(x2 - x1)),
        h: Math.max(1, Math.abs(y2 - y1)),
      })
      return
    }
    if (d.type === 'move') {
      const dx = Math.round(dev.x - d.startDev.x)
      const dy = Math.round(dev.y - d.startDev.y)
      const r = d.startRegion
      emit('update:region', {
        x: Math.max(0, Math.min(deviceW.value - r.w, r.x + dx)),
        y: Math.max(0, Math.min(deviceH.value - r.h, r.y + dy)),
        w: r.w,
        h: r.h,
      })
      return
    }
    if (d.type === 'resize') {
      emit('update:region', resizeRegion(d.startRegion, d.handle, dev))
      return
    }
  }

  // 光标反馈
  const canvas = canvasRef.value
  if (props.panMode) {
    canvas.style.cursor = 'grab'
  } else if (props.offsetPicking) {
    canvas.style.cursor = 'crosshair'
  } else if (props.mode === 'color') {
    canvas.style.cursor = 'crosshair'
  } else if (hitHandle(pt.x, pt.y)) {
    const h = hitHandle(pt.x, pt.y)
    canvas.style.cursor = h === 'n' || h === 's' ? 'ns-resize' : h === 'e' || h === 'w' ? 'ew-resize' : h === 'ne' || h === 'sw' ? 'nesw-resize' : 'nwse-resize'
  } else if (insideRegion(dev)) {
    canvas.style.cursor = 'move'
  } else {
    canvas.style.cursor = 'crosshair'
  }
  schedule()
}

function resizeRegion(start, handle, dev) {
  let x1 = start.x
  let y1 = start.y
  let x2 = start.x + start.w
  let y2 = start.y + start.h
  const dx = Math.floor(dev.x)
  const dy = Math.floor(dev.y)

  if (handle.includes('w')) x1 = Math.min(dx, x2 - 1)
  if (handle.includes('e')) x2 = Math.max(dx, x1 + 1)
  if (handle.includes('n')) y1 = Math.min(dy, y2 - 1)
  if (handle.includes('s')) y2 = Math.max(dy, y1 + 1)

  x1 = Math.max(0, x1)
  y1 = Math.max(0, y1)
  x2 = Math.min(deviceW.value, x2)
  y2 = Math.min(deviceH.value, y2)

  return { x: x1, y: y1, w: Math.max(1, x2 - x1), h: Math.max(1, y2 - y1) }
}

function onPointerUp(ev) {
  if (drag.value) {
    const d = drag.value
    drag.value = null
    if (d.type === 'new' && props.region && props.region.w < 3 && props.region.h < 3) {
      emit('update:region', null)
    }
    schedule()
  }
  if (canvasRef.value) canvasRef.value.style.cursor = props.panMode ? 'grab' : ''
  try {
    canvasRef.value.releasePointerCapture(ev.pointerId)
  } catch {}
}

function onPointerLeave() {
  hoverDev.value = null
  hoverColor.value = ''
  emit('hover', null)
  if (!drag.value) schedule()
}

function onWheel(ev) {
  if (!ev.ctrlKey) return
  ev.preventDefault()
  zoomBy(ev.deltaY < 0 ? 1.12 : 1 / 1.12)
}

function zoomBy(factor) {
  const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom.value * factor))
  if (next === zoom.value) return
  zoom.value = next
  pan.value = next <= 1.001 ? { x: 0, y: 0 } : clampPanValue(pan.value.x, pan.value.y)
  schedule()
}

/** 原画 1:1：一个设备像素对应一个 CSS 像素 */
function zoomToActual() {
  const target = 1 / fitScale.value
  zoom.value = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, target))
  pan.value = clampPanValue(pan.value.x, pan.value.y)
  emit('request-original')
  schedule()
}

function resetZoom() {
  zoom.value = 1
  pan.value = { x: 0, y: 0 }
  schedule()
}

function toggleGrid() {
  showGrid.value = !showGrid.value
  schedule()
}

function onKeyDown(ev) {
  const step = ev.shiftKey ? 10 : 1
  const map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
  if (map[ev.key]) {
    ev.preventDefault()
    if (props.mode === 'region' && props.region) {
      const [dx, dy] = map[ev.key]
      const r = props.region
      emit('update:region', {
        x: Math.max(0, Math.min(deviceW.value - r.w, r.x + dx)),
        y: Math.max(0, Math.min(deviceH.value - r.h, r.y + dy)),
        w: r.w,
        h: r.h,
      })
    } else if (props.mode === 'color' && props.anchor) {
      const [dx, dy] = map[ev.key]
      emit('pick', {
        x: Math.max(0, Math.min(deviceW.value - 1, props.anchor.x + dx)),
        y: Math.max(0, Math.min(deviceH.value - 1, props.anchor.y + dy)),
      })
    }
    return
  }
  if (ev.key === 'Escape') {
    if (props.offsetPicking) {
      emit('update:offsetPicking', false)
      return
    }
    if (props.mode === 'region') emit('update:region', null)
    return
  }
  if (ev.key === 'Delete' || ev.key === 'Backspace') {
    if (props.mode === 'region') emit('update:region', null)
  }
  if (ev.key === 'p' || ev.key === 'P') {
    if (props.mode === 'region' && props.region) {
      ev.preventDefault()
      emit('update:offsetPicking', !props.offsetPicking)
    }
    return
  }
  if (ev.key === 'r' || ev.key === 'R') {
    emit('resume')
  }
  if (ev.key === '+' || ev.key === '=') {
    ev.preventDefault()
    zoomBy(1.25)
    return
  }
  if (ev.key === '-' || ev.key === '_') {
    ev.preventDefault()
    zoomBy(1 / 1.25)
    return
  }
  if (ev.key === '0') {
    ev.preventDefault()
    resetZoom()
    return
  }
  if (ev.key === 'h' || ev.key === 'H') {
    ev.preventDefault()
    emit('update:panMode', !props.panMode)
    return
  }
  if (ev.key === 'g' || ev.key === 'G') {
    ev.preventDefault()
    toggleGrid()
    return
  }
  if (ev.key === '1') {
    ev.preventDefault()
    emit('update:mode', 'region')
    return
  }
  if (ev.key === '2') {
    ev.preventDefault()
    emit('update:mode', 'color')
    return
  }
  if (ev.key === 't' || ev.key === 'T') {
    ev.preventDefault()
    emit('update:showToolbar', !props.showToolbar)
  }
}

function onKeyupSpace(ev) {
  if (ev.code === 'Space' && ev.target?.tagName !== 'INPUT' && ev.target?.tagName !== 'TEXTAREA') {
    spaceDown.value = false
  }
}

function onKeydownSpace(ev) {
  if (ev.code === 'Space' && ev.target?.tagName !== 'INPUT' && ev.target?.tagName !== 'TEXTAREA') {
    spaceDown.value = true
  }
}

let ro = null
onMounted(() => {
  resize()
  ro = new ResizeObserver(() => resize())
  ro.observe(stageRef.value)
  window.addEventListener('keyup', onKeyupSpace)
  window.addEventListener('keydown', onKeydownSpace)
})

onBeforeUnmount(() => {
  ro?.disconnect()
  window.removeEventListener('keyup', onKeyupSpace)
  window.removeEventListener('keydown', onKeydownSpace)
  if (rafId) cancelAnimationFrame(rafId)
  if (sourceCanvas) sourceCanvas = null
})

watch(
  () => props.bitmap,
  async (bmp) => {
    if (!bmp) {
      sourceCanvas = null
      schedule()
      return
    }
    await nextTick()
    rebuildSource()
    schedule()
  },
  { immediate: true },
)

watch(() => [props.mode, props.region, props.anchor, props.matches, props.bbox, props.frozen, props.offsets, props.offsetPicking], schedule, { deep: true })
watch(() => [props.meta?.deviceWidth, props.meta?.deviceHeight], schedule)
</script>

<style scoped>
.stage {
  position: absolute;
  inset: 0;
  overflow: hidden;
  container-type: inline-size;
}

.stage-canvas {
  display: block;
  width: 100%;
  height: 100%;
  outline: none;
  touch-action: none;
}

.stage.mode-color .stage-canvas {
  cursor: crosshair;
}

.stage.picking-offset .stage-canvas {
  cursor: crosshair;
}

.overlay-toggle {
  position: absolute;
  top: 12px;
  left: 12px;
  width: 28px;
  height: 28px;
  border-radius: 9px;
  border: 1px solid rgba(226, 232, 240, 0.95);
  background: rgba(255, 255, 255, 0.86);
  backdrop-filter: blur(10px);
  color: #64748b;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 6;
  opacity: 0.5;
  transition: all 0.15s;
  font-size: 14px;
}

.overlay-toggle:hover {
  opacity: 1;
  color: #0b8480;
  background: #fff;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.1);
}

.overlay-toggle.off {
  opacity: 0.75;
  color: #0ea5a0;
  border-color: #b7e6e3;
}

.stage-tools {
  position: absolute;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  background: rgba(255, 255, 255, 0.94);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 12px;
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.1);
  z-index: 4;
}

.seg {
  display: flex;
  gap: 2px;
  background: #f1f5f9;
  border-radius: 9px;
  padding: 2px;
}

.seg button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: none;
  background: transparent;
  font-size: 12px;
  color: #64748b;
  padding: 5px 10px;
  border-radius: 7px;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
  white-space: nowrap;
}

.seg button:hover {
  color: #0f766e;
}

.seg button.active {
  background: #fff;
  color: #0b8480;
  font-weight: 600;
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.12);
}

.tool-sep {
  width: 1px;
  height: 18px;
  background: #e2e8f0;
}

.icon-btn {
  border: none;
  background: transparent;
  color: #64748b;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s;
}

.icon-btn:hover {
  background: #f1f5f9;
  color: #0b8480;
}

.icon-btn.active {
  background: #eef8f8;
  color: #0ea5a0;
}

.preset-btn {
  border: 1px solid transparent;
  background: transparent;
  color: #475569;
  font-size: 11.5px;
  line-height: 1;
  padding: 6px 8px;
  border-radius: 7px;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
  transition: all 0.15s;
}

.preset-btn:hover {
  background: #f1f5f9;
  color: #0b8480;
}

.preset-btn.active {
  background: #eef8f8;
  color: #0b8480;
  font-weight: 600;
  border-color: #cdeae8;
}

.zoom-label {
  border: none;
  background: transparent;
  font-size: 11px;
  color: #475569;
  cursor: pointer;
  width: 44px;
  font-family: var(--app-mono);
}

.freeze-badge {
  position: absolute;
  top: 14px;
  right: 14px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid rgba(245, 158, 11, 0.4);
  background: rgba(255, 251, 235, 0.96);
  color: #b45309;
  font-size: 12px;
  padding: 6px 11px;
  border-radius: 9px;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.08);
  z-index: 4;
  font-family: inherit;
}

.freeze-badge:hover {
  background: #fef3c7;
}

.stage-hint {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11.5px;
  color: #64748b;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(10px);
  padding: 6px 12px;
  border-radius: 9px;
  border: 1px solid rgba(226, 232, 240, 0.9);
  white-space: nowrap;
  z-index: 3;
  pointer-events: none;
}

.stage-hint b {
  color: #0b8480;
  font-weight: 600;
}

.stage-hint .dot {
  color: #cbd5e1;
}

.coord-readout {
  position: absolute;
  bottom: 52px;
  right: 14px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: #1e293b;
  background: rgba(255, 255, 255, 0.94);
  border: 1px solid rgba(226, 232, 240, 0.9);
  padding: 5px 10px;
  border-radius: 8px;
  z-index: 3;
  pointer-events: none;
}

.coord-readout .c-label {
  color: #94a3b8;
  font-size: 10px;
  margin-right: -2px;
}

.coord-readout .swatch {
  width: 14px;
  height: 14px;
  border-radius: 4px;
}

.coord-readout .c-hex {
  font-weight: 600;
}

.stage-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: #94a3b8;
  pointer-events: none;
}

.stage-empty .empty-icon {
  font-size: 42px;
  color: #cbd5e1;
  margin-bottom: 6px;
}

.stage-empty p {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #64748b;
}

.stage-empty span {
  font-size: 12px;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* 容器较窄时：冻结角标下移，避免与浮动工具栏重叠 */
@container (max-width: 980px) {
  .freeze-badge {
    top: 58px;
    right: 10px;
  }
}

/* 画布区域较窄时：工具条换行、底部提示收紧 */
@container (max-width: 560px) {
  .stage-tools {
    left: 8px;
    right: 8px;
    transform: none;
    flex-wrap: wrap;
    justify-content: center;
    gap: 4px;
    padding: 4px 6px;
  }

  .seg button {
    padding: 5px 8px;
    font-size: 11.5px;
  }

  .stage-hint {
    left: 8px;
    right: 8px;
    transform: none;
    flex-wrap: wrap;
    justify-content: center;
    white-space: normal;
    text-align: center;
    font-size: 10.5px;
    row-gap: 2px;
    padding: 5px 8px;
  }

  .freeze-badge {
    top: auto;
    bottom: 54px;
    right: 8px;
    font-size: 11px;
    padding: 5px 9px;
  }

  .coord-readout {
    bottom: 96px;
  }
}
</style>
