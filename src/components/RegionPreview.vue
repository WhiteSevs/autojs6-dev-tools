<template>
  <div class="preview-block">
    <div class="preview-head">
      <span class="preview-title">
        <el-icon><Picture /></el-icon>
        区域预览
      </span>
      <span class="preview-meta mono">{{ metaText }}</span>
      <button class="preview-open" :disabled="!canPreview" @click="openDialog">
        <el-icon><FullScreen /></el-icon>
        <span>大图</span>
      </button>
    </div>

    <div class="preview-body" :class="{ 'is-clickable': canPreview }" :style="thumbStyle" @click="openDialog">
      <canvas ref="thumbRef" class="preview-canvas" />
      <div v-if="!canPreview" class="preview-mask">{{ hasSource ? '没有区域' : '没有画面' }}</div>
      <span v-else class="preview-zoom mono">{{ thumbZoomText }}</span>
    </div>
  </div>

  <el-dialog
    v-model="dialog"
    width="min(960px, 88vw)"
    top="6vh"
    append-to-body
    class="region-preview-dialog"
    @opened="onOpened"
    @closed="onClosed"
  >
    <template #header>
      <div class="dlg-head">
        <span class="dlg-icon"><el-icon><Picture /></el-icon></span>
        <div class="dlg-text">
          <div class="dlg-title">区域预览</div>
          <div class="dlg-sub mono">
            {{ region ? `${region.w} × ${region.h}` : '' }} 设备像素 · 按 1:1 原始像素导出
          </div>
        </div>
      </div>
    </template>

    <div class="dlg-tools">
      <div class="zoom-seg">
        <button :class="{ active: zoomMode === 'fit' }" @click="setZoom('fit')">适应</button>
        <button :class="{ active: zoomMode === 'manual' && ratio === 1 }" @click="setZoom(1)">1:1</button>
        <button :class="{ active: zoomMode === 'manual' && ratio === 2 }" @click="setZoom(2)">2×</button>
        <button :class="{ active: zoomMode === 'manual' && ratio === 4 }" @click="setZoom(4)">4×</button>
      </div>
      <span class="dlg-ratio mono">{{ ratioText }}</span>
      <span class="dlg-note">滚轮缩放 · 双击在适应 / 1:1 之间切换</span>
    </div>

    <div ref="stageRef" class="dlg-stage" @wheel.prevent="onWheel">
      <div v-if="loading" class="dlg-state">
        <el-icon class="spin"><Loading /></el-icon>
        <span>正在导出 1:1 原图…</span>
      </div>
      <img
        v-else-if="bigUrl"
        class="dlg-img"
        :src="bigUrl"
        :style="imgStyle"
        alt="区域预览"
        @dblclick="toggleActual"
      />
      <div v-else class="dlg-state">预览不可用，请重新框选后再试</div>
    </div>

    <div class="dlg-foot">
      <span class="mono">{{ regionText }}</span>
      <span class="mono">{{ pixelText }}</span>
    </div>
  </el-dialog>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { shotBlob } from '../api'
import { formatRegionText } from '../utils/region'

const props = defineProps({
  /** 当前画面（ImageBitmap） */
  bitmap: { type: Object, default: null },
  /** 画面元信息：width / height 是传输帧尺寸，deviceWidth / deviceHeight 是设备坐标尺寸，scale 是传输缩放比 */
  meta: { type: Object, default: null },
  /** 区域，设备物理像素坐标 */
  region: { type: Object, default: null },
  serial: { type: String, default: '' },
  frameId: { type: Number, default: null },
})

const thumbRef = ref(null)
const stageRef = ref(null)
const thumbZoomText = ref('')

const dialog = ref(false)
const loading = ref(false)
const bigUrl = ref('')
const bigInfo = ref(null)
const zoomMode = ref('fit')
const manualRatio = ref(1)
const stageSize = ref({ w: 0, h: 0 })

const hasSource = computed(() => !!props.bitmap && !!props.meta && !!props.region)
const canPreview = computed(() => hasSource.value || (!!props.serial && !!props.region))
const regionText = computed(() => formatRegionText(props.region))

/** 区域在「传输帧」里的像素矩形（区域是设备坐标，按 meta.scale 折算） */
const sourceRect = computed(() => {
  const bmp = props.bitmap
  const m = props.meta
  const r = props.region
  if (!bmp || !m || !r) return null
  const s = m.scale || 1
  const bw = bmp.width || m.width || 0
  const bh = bmp.height || m.height || 0
  if (!bw || !bh) return null
  const x = Math.max(0, Math.min(bw - 1, Math.floor(r.x / s)))
  const y = Math.max(0, Math.min(bh - 1, Math.floor(r.y / s)))
  const w = Math.min(bw - x, Math.max(1, Math.ceil(r.w / s)))
  const h = Math.min(bh - y, Math.max(1, Math.ceil(r.h / s)))
  return { x, y, w, h }
})

const metaText = computed(() => {
  const src = sourceRect.value
  if (!src) return ''
  const s = props.meta?.scale || 1
  return s > 1 ? `${src.w} × ${src.h} px · 画面 1/${s}` : `${src.w} × ${src.h} px`
})

/* ------------------------------ 缩略预览 ------------------------------ */
let thumbRaf = 0
let thumbRo = null

/** 缩略图跟着区域长宽比走，横图 / 竖图都能少留空白 */
const thumbStyle = computed(() => {
  const r = props.region
  if (!r || !r.w || !r.h) return {}
  return { aspectRatio: `${r.w} / ${r.h}` }
})

function scheduleThumb() {
  if (thumbRaf) return
  thumbRaf = requestAnimationFrame(() => {
    thumbRaf = 0
    renderThumb()
  })
}

function renderThumb() {
  const canvas = thumbRef.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  const cw = Math.round(rect.width)
  const ch = Math.round(rect.height)
  const dpr = window.devicePixelRatio || 1
  const pw = Math.round(cw * dpr)
  const ph = Math.round(ch * dpr)
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw
    canvas.height = ph
  }
  const c = canvas.getContext('2d')
  if (!c) return

  c.setTransform(dpr, 0, 0, dpr, 0, 0)
  c.clearRect(0, 0, cw, ch)
  // 截图永远是实底，用一块浅色底板就够，别用棋盘格（会被误读成透明）
  c.fillStyle = '#eef2f7'
  c.fillRect(0, 0, cw, ch)

  const src = sourceRect.value
  if (!src || !props.bitmap) {
    thumbZoomText.value = ''
    return
  }

  const s = Math.min(cw / src.w, ch / src.h)
  const dw = Math.max(1, src.w * s)
  const dh = Math.max(1, src.h * s)
  const dx = (cw - dw) / 2
  const dy = (ch - dh) / 2

  c.imageSmoothingEnabled = s <= 1.5
  try {
    c.drawImage(props.bitmap, src.x, src.y, src.w, src.h, dx, dy, dw, dh)
  } catch {
    // ImageBitmap 可能刚被换掉 / 关闭，下一帧再画
  }
  c.imageSmoothingEnabled = true

  c.strokeStyle = 'rgba(15,23,42,0.18)'
  c.lineWidth = 1
  c.strokeRect(dx + 0.5, dy + 0.5, Math.max(0, dw - 1), Math.max(0, dh - 1))

  thumbZoomText.value = s <= 1 ? `${Math.max(1, Math.round(s * 100))}%` : `${s.toFixed(s >= 10 ? 0 : 1)}×`
}

/* ------------------------------ 大图预览 ------------------------------ */
const imageSize = computed(() => {
  if (bigInfo.value) return bigInfo.value
  const src = sourceRect.value
  return {
    width: src?.w || props.region?.w || 0,
    height: src?.h || props.region?.h || 0,
  }
})

const fitRatio = computed(() => {
  const { width, height } = imageSize.value
  const { w, h } = stageSize.value
  if (!width || !height || !w || !h) return 1
  return Math.min((w - 32) / width, (h - 32) / height, 8)
})

const ratio = computed(() => (zoomMode.value === 'fit' ? fitRatio.value : manualRatio.value))

const ratioText = computed(() => {
  const r = ratio.value
  if (!r) return ''
  return r <= 1 ? `${Math.round(r * 100)}%` : `${r.toFixed(r >= 10 ? 0 : 1)}×`
})

const imgStyle = computed(() => ({
  width: `${Math.max(1, Math.round(imageSize.value.width * ratio.value))}px`,
  height: `${Math.max(1, Math.round(imageSize.value.height * ratio.value))}px`,
  imageRendering: ratio.value >= 1 ? 'pixelated' : 'auto',
}))

const pixelText = computed(() => {
  const { width, height } = imageSize.value
  return width ? `${width} × ${height} px · PNG 无损` : ''
})

function measureStage() {
  const el = stageRef.value
  if (!el) return
  stageSize.value = { w: el.clientWidth, h: el.clientHeight }
}

function setZoom(v) {
  if (v === 'fit') {
    zoomMode.value = 'fit'
    return
  }
  zoomMode.value = 'manual'
  manualRatio.value = v
}

function toggleActual() {
  if (zoomMode.value === 'fit') setZoom(1)
  else setZoom('fit')
}

function onWheel(e) {
  const base = ratio.value || 1
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
  zoomMode.value = 'manual'
  manualRatio.value = Math.max(0.1, Math.min(16, base * factor))
}

function releaseBig() {
  if (bigUrl.value) {
    URL.revokeObjectURL(bigUrl.value)
    bigUrl.value = ''
  }
  bigInfo.value = null
}

/** 服务端不可用时，用画面上正在显示的那一帧裁剪出一张预览 */
function clientCropUrl() {
  const src = sourceRect.value
  if (!src || !props.bitmap) return Promise.resolve('')
  const canvas = document.createElement('canvas')
  canvas.width = src.w
  canvas.height = src.h
  try {
    canvas.getContext('2d').drawImage(props.bitmap, src.x, src.y, src.w, src.h, 0, 0, src.w, src.h)
  } catch {
    return Promise.resolve('')
  }
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : ''), 'image/png')
  })
}

let reqToken = 0

async function loadBig() {
  const token = ++reqToken
  releaseBig()
  if (!props.region) return
  loading.value = true

  const fallback = async () => {
    const url = await clientCropUrl()
    if (token === reqToken && url) bigUrl.value = url
  }

  try {
    if (!props.serial) throw new Error('没有可用的画面数据源')
    const blob = await shotBlob({
      serial: props.serial,
      frameId: props.frameId,
      region: props.region,
    })
    if (token !== reqToken) return
    bigUrl.value = URL.createObjectURL(blob)
    const bmp = await createImageBitmap(blob).catch(() => null)
    if (bmp) {
      bigInfo.value = { width: bmp.width, height: bmp.height }
      bmp.close?.()
    }
  } catch {
    await fallback()
  } finally {
    if (token === reqToken) {
      loading.value = false
      nextTick(measureStage)
    }
  }
}

function openDialog() {
  if (!canPreview.value || dialog.value) return
  dialog.value = true
  zoomMode.value = 'fit'
  stageSize.value = { w: 0, h: 0 }
  loadBig()
}

let stageRo = null

function onOpened() {
  measureStage()
  if (stageRef.value && !stageRo) {
    stageRo = new ResizeObserver(measureStage)
    stageRo.observe(stageRef.value)
  }
}

function onClosed() {
  stageRo?.disconnect()
  stageRo = null
  reqToken++
  releaseBig()
}

/* ------------------------------ 生命周期 ------------------------------ */
watch(
  () => [props.bitmap, props.region?.x, props.region?.y, props.region?.w, props.region?.h, props.meta?.scale],
  scheduleThumb,
)

watch(
  () => props.region,
  () => {
    // 区域变了，已打开的大图跟着重取
    if (dialog.value) loadBig()
  },
  { deep: true },
)

onMounted(() => {
  scheduleThumb()
  if (typeof ResizeObserver !== 'undefined' && thumbRef.value) {
    thumbRo = new ResizeObserver(scheduleThumb)
    thumbRo.observe(thumbRef.value)
  }
})

onBeforeUnmount(() => {
  thumbRo?.disconnect()
  stageRo?.disconnect()
  if (thumbRaf) cancelAnimationFrame(thumbRaf)
  reqToken++
  releaseBig()
})
</script>

<style scoped>
.preview-block {
  margin-bottom: 10px;
  border: 1px solid #e4ecf5;
  border-radius: 10px;
  background: #fbfdff;
  padding: 8px 9px 9px;
}

.preview-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 7px;
}

.preview-title {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 600;
  color: #0b8480;
}

.preview-meta {
  font-size: 10.5px;
  color: #94a3b8;
  margin-left: auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-open {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex: 0 0 auto;
  font-family: inherit;
  font-size: 11px;
  line-height: 1;
  padding: 4px 7px;
  border-radius: 6px;
  border: 1px solid #cdeae8;
  background: #fff;
  color: #0b8480;
  cursor: pointer;
  transition: all 0.15s;
}

.preview-open:hover:not(:disabled) {
  background: #eef8f8;
  border-color: #9fdcd8;
}

.preview-open:disabled {
  color: #cbd5e1;
  border-color: #e8eef6;
  cursor: not-allowed;
}

.preview-body {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  min-height: 92px;
  max-height: 168px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #eef3f9;
  background: #eef2f7;
}

.preview-body.is-clickable {
  cursor: zoom-in;
}

.preview-canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.preview-mask {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11.5px;
  color: #a1aebf;
  background: rgba(248, 250, 252, 0.72);
}

.preview-zoom {
  position: absolute;
  right: 6px;
  bottom: 6px;
  font-size: 10px;
  line-height: 1;
  padding: 3px 5px;
  border-radius: 5px;
  color: #475569;
  background: rgba(255, 255, 255, 0.86);
  border: 1px solid rgba(226, 232, 240, 0.9);
  pointer-events: none;
}

/* ------------------------------ 弹窗 ------------------------------ */
.dlg-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.dlg-icon {
  width: 30px;
  height: 30px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #eef8f8;
  color: #0ea5a0;
  font-size: 16px;
}

.dlg-title {
  font-size: 15px;
  font-weight: 700;
  color: #1e293b;
  line-height: 1.2;
}

.dlg-sub {
  font-size: 11.5px;
  color: #94a3b8;
}

.dlg-tools {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.zoom-seg {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  background: #f1f5f9;
  border-radius: 9px;
}

.zoom-seg button {
  border: none;
  background: transparent;
  font-family: inherit;
  font-size: 11.5px;
  color: #64748b;
  padding: 4px 10px;
  border-radius: 7px;
  cursor: pointer;
  transition: all 0.15s;
}

.zoom-seg button:hover {
  color: #0b8480;
}

.zoom-seg button.active {
  background: #fff;
  color: #0b8480;
  font-weight: 600;
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.12);
}

.dlg-ratio {
  font-size: 11.5px;
  color: #475569;
  min-width: 40px;
}

.dlg-note {
  margin-left: auto;
  font-size: 11px;
  color: #b0bccd;
}

.dlg-stage {
  height: min(62vh, 620px);
  overflow: auto;
  display: flex;
  padding: 14px;
  border-radius: 10px;
  border: 1px solid var(--app-border);
  background-color: #f8fafc;
  background-image:
    linear-gradient(45deg, #edf2f8 25%, transparent 25%),
    linear-gradient(-45deg, #edf2f8 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #edf2f8 75%),
    linear-gradient(-45deg, transparent 75%, #edf2f8 75%);
  background-size: 16px 16px;
  background-position:
    0 0,
    0 8px,
    8px -8px,
    -8px 0;
}

.dlg-img {
  margin: auto;
  display: block;
  flex: 0 0 auto;
  border-radius: 2px;
  box-shadow: 0 4px 18px rgba(15, 23, 42, 0.16);
}

.dlg-state {
  margin: auto;
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: #64748b;
}

.spin {
  animation: preview-spin 0.9s linear infinite;
}

@keyframes preview-spin {
  to {
    transform: rotate(360deg);
  }
}

.dlg-foot {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
  font-size: 11.5px;
  color: #64748b;
}
</style>

<!-- 弹窗被 teleport 到 body，样式不能带 scoped 属性选择器 -->
<style>
.region-preview-dialog .el-dialog__body {
  padding: 4px 18px 16px;
}

.region-preview-dialog .el-dialog {
  border-radius: 14px;
}

.region-preview-dialog .el-dialog__header {
  margin-right: 0;
  padding-bottom: 10px;
}
</style>
