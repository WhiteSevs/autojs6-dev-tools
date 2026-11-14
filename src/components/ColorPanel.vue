<template>
  <div class="panel-card">
    <div class="panel-head">
      <span class="panel-head-icon"><el-icon><Aim /></el-icon></span>
      <span class="panel-title">锚点取色</span>
      <span class="panel-head-extra">
        <el-tag v-if="result" size="small" :type="result.total ? 'warning' : 'info'" effect="light" round>
          {{ result.total }} 处命中
        </el-tag>
      </span>
    </div>

    <!-- 坐标输入：没有锚点时也能用，回车 / 粘贴即取该点颜色 -->
    <div class="coord-box">
      <div class="coord-head">
        <span class="coord-title">
          <el-icon><EditPen /></el-icon>
          坐标输入
        </span>
        <span class="coord-sub">回车 / 粘贴即取色</span>
        <button class="coord-paste" @click="readClipboard">
          <el-icon><DocumentCopy /></el-icon>
          <span>读剪贴板</span>
        </button>
      </div>
      <div class="coord-row">
        <el-input
          v-model="coordText"
          class="coord-input mono"
          size="small"
          placeholder="x, y"
          @keydown.enter="applyCoord"
          @paste="onPaste"
          @focus="coordFocused = true"
          @blur="coordFocused = false"
        >
          <template #suffix>
            <el-icon
              class="coord-clear"
              aria-label="清空坐标并清除锚点"
              @mousedown.prevent
              @click.stop="clearCoord"
            >
              <CircleClose />
            </el-icon>
          </template>
        </el-input>
        <el-button size="small" type="primary" plain @click="applyCoord">取色</el-button>
      </div>
      <div class="coord-hint">
        支持 <span class="mono">100, 200</span>、<span class="mono">[100, 200]</span> 与
        <span class="mono">x=100 y=200</span>；粘区域坐标或一整段脚本也行，取前两个数字。留空回车可清除锚点。
      </div>
    </div>

    <template v-if="anchor">
      <div class="anchor-box">
        <button class="anchor-swatch" :style="{ background: swatchBg }" title="点击复制颜色" @click="copyColor" />
        <div class="anchor-info">
          <div class="anchor-row">
            <span class="k">颜色</span>
            <b class="mono color-text" title="点击复制颜色" @click="copyColor">{{ colorText }}</b>
            <button class="fmt-btn" title="按 Shift 也能切换" @click="cycleFormat">{{ formatText }}</button>
          </div>
          <div class="anchor-row">
            <span class="k">坐标</span>
            <b class="mono">{{ anchor.x }}, {{ anchor.y }}</b>
          </div>
          <div class="anchor-row">
            <span class="k">RGB</span>
            <b class="mono">{{ anchor.r }}, {{ anchor.g }}, {{ anchor.b }}</b>
          </div>
          <div class="anchor-row">
            <span class="k">整数</span>
            <b class="mono">0x{{ decimalHex }}</b>
          </div>
        </div>
      </div>

      <div class="hint-text color-hint">
        <span class="kbd">C</span> 复制当前颜色 · <span class="kbd">Shift</span> 切换格式（{{ formatSample }}）
      </div>

      <div class="field-row">
        <span class="field-label">找色值</span>
        <el-color-picker
          :model-value="color || anchor.hex"
          size="small"
          color-format="hex"
          @change="(v) => emit('update:color', v)"
        />
        <el-input
          class="field-grow"
          :model-value="color || anchor.hex"
          size="small"
          placeholder="#RRGGBB"
          @update:model-value="(v) => emit('update:color', v)"
        >
          <template #prefix><span class="mono" style="font-size: 11px; color: #94a3b8">HEX</span></template>
        </el-input>
      </div>

      <div class="field-row slider-row">
        <span class="field-label">容差</span>
        <el-slider
          class="field-grow"
          :model-value="threshold"
          :min="0"
          :max="64"
          :step="1"
          size="small"
          :show-tooltip="false"
          @update:model-value="(v) => emit('update:threshold', v)"
        />
        <el-tooltip content="AutoJs6 threshold：每个通道允许的最大色差，越大匹配越宽松" placement="top">
          <span class="num-tag" style="width: 34px; text-align: center">{{ threshold }}</span>
        </el-tooltip>
      </div>

      <div class="field-row">
        <span class="field-label">范围</span>
        <el-switch
          :model-value="restrict"
          size="small"
          :disabled="!hasRegion"
          @update:model-value="(v) => emit('update:restrict', v)"
        />
        <span class="hint-text">
          {{ hasRegion ? '仅在框选区域内查找' : '未框选区域，默认全屏查找' }}
        </span>
      </div>

      <div class="row-actions">
        <el-button size="small" type="primary" :loading="loading" @click="emit('find')">
          <el-icon><Search /></el-icon>&nbsp;{{ loading ? '查找中' : '全屏找色' }}
        </el-button>
        <el-button size="small" @click="emit('clear')">清除锚点</el-button>
      </div>

      <div v-if="result" class="result-box">
        <div class="result-line">
          <el-icon><Odometer /></el-icon>
          <span>
            扫描 <b class="mono">{{ result.frame.width }}×{{ result.frame.height }}</b>
            · 命中 <b class="mono">{{ result.total }}</b> 个像素
            · 耗时 <b class="mono">{{ result.elapsed }}ms</b>
          </span>
        </div>
        <div v-if="result.bbox" class="result-line">
          <el-icon><FullScreen /></el-icon>
          <span>
            覆盖区域 <b class="mono">[{{ result.bbox.x }}, {{ result.bbox.y }}, {{ result.bbox.w }}, {{ result.bbox.h }}]</b>
          </span>
        </div>
        <div v-if="result.matches.length" class="match-tags">
          <button
            v-for="(m, i) in result.matches.slice(0, 12)"
            :key="`${m.x}-${m.y}`"
            class="match-tag mono"
            :class="{ first: i === 0 }"
            @click="copyPoint(m)"
          >
            {{ m.x }}, {{ m.y }}
          </button>
          <span v-if="result.matches.length > 12" class="more">+{{ result.total - 12 }}</span>
        </div>
        <div v-if="!result.total" class="hint-text" style="margin-top: 6px">
          没有找到匹配像素：尝试提高容差，或改用画面上真实存在的颜色。
        </div>
      </div>

      <CodeCard title="AutoJs6 · 锚点找色" :code="code" />
    </template>

    <div v-else class="empty-hint">
      在画面上单击，或在上方输入 / 粘贴坐标<br />
      即可读取该点的精确颜色与坐标
      <div class="hover-tip">
        只是把鼠标移上去、不点击也可以：<br />
        <span class="kbd">C</span> 复制颜色 · <span class="kbd">Shift</span> 切换格式
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import CodeCard from './CodeCard.vue'
import { copyText } from '../api'
import { formatColor, formatExample, formatLabel, nextFormat, toHex } from '../utils/color'
import { parsePoint } from '../utils/region'

const props = defineProps({
  anchor: { type: Object, default: null },
  color: { type: String, default: '' },
  threshold: { type: Number, default: 4 },
  restrict: { type: Boolean, default: false },
  hasRegion: { type: Boolean, default: false },
  result: { type: Object, default: null },
  loading: { type: Boolean, default: false },
  format: { type: String, default: 'hex' },
  /** 画布尺寸：坐标输入会按它裁剪，避免填出画面外的点 */
  deviceW: { type: Number, default: 0 },
  deviceH: { type: Number, default: 0 },
})

const emit = defineEmits(['update:color', 'update:threshold', 'update:restrict', 'update:format', 'find', 'clear', 'pick'])

/* ------------------------------ 坐标输入 ------------------------------ */
const coordText = ref('')
const coordFocused = ref(false)

/** 锚点变了就回填输入框（画面上单击取色、清除锚点都会走到这里）；正在输入时不打断 */
watch(
  () => props.anchor,
  (a) => {
    if (coordFocused.value) return
    coordText.value = a ? `${a.x}, ${a.y}` : ''
  },
  { immediate: true },
)

/** 手输 / 粘贴的坐标 → 让 App 去这一取色（和画面上单击等价） */
function applyCoord() {
  const text = String(coordText.value ?? '').trim()
  if (!text) {
    // 留空回车 = 清除锚点，和输入框右侧的 × 一致
    emit('clear')
    return
  }
  const res = parsePoint(text, { width: props.deviceW, height: props.deviceH })
  if (!res.ok) {
    ElMessage.warning(res.error)
    return
  }
  coordText.value = `${res.point.x}, ${res.point.y}`
  emit('pick', res.point)
}

/** 粘贴时先尝试解析：能解析就直接取色，解析不了就让文本正常进输入框再手改 */
function onPaste(ev) {
  const text = ev.clipboardData?.getData('text') || ''
  if (!text.trim()) return
  const res = parsePoint(text, { width: props.deviceW, height: props.deviceH })
  if (!res.ok) return
  ev.preventDefault()
  coordText.value = `${res.point.x}, ${res.point.y}`
  emit('pick', res.point)
}

async function readClipboard() {
  try {
    if (!navigator.clipboard?.readText) throw new Error('浏览器不允许读取剪贴板，请直接 Ctrl+V 粘贴')
    const text = await navigator.clipboard.readText()
    if (!text?.trim()) {
      ElMessage.info('剪贴板里没有文本')
      return
    }
    coordText.value = text.trim()
    applyCoord()
  } catch (err) {
    ElMessage.warning(err.message || '读取剪贴板失败，请直接 Ctrl+V 粘贴')
  }
}

function clearCoord() {
  coordText.value = ''
  emit('clear')
}

const decimalHex = computed(() => {
  if (!props.anchor) return '000000'
  return (props.anchor.decimal ?? 0).toString(16).toUpperCase().padStart(6, '0')
})

/** 当前展示的颜色：优先用「找色值」输入框里的改动，其次锚点色 */
const currentColor = computed(() => props.color || props.anchor?.hex || '')
const swatchBg = computed(() => toHex(currentColor.value) || 'transparent')
const colorText = computed(() => formatColor(currentColor.value, props.format) || props.anchor?.hex || '')
const formatText = computed(() => formatLabel(props.format))
const formatSample = computed(() => formatExample(props.format))

async function copyColor() {
  if (!colorText.value) return
  const ok = await copyText(colorText.value)
  ok ? ElMessage.success(`已复制 ${colorText.value}`) : ElMessage.error('复制失败')
}

function cycleFormat() {
  emit('update:format', nextFormat(props.format))
}

const normalizedColor = computed(() => {
  const c = (props.color || props.anchor?.hex || '').trim().toUpperCase()
  return c.startsWith('#') ? c : `#${c}`
})

const code = computed(() => {
  if (!props.anchor) return ''
  const colorStr = normalizedColor.value
  const { x, y } = props.anchor
  const opts = `{ threshold: ${props.threshold}${props.restrict ? ', region }' : ' }'}`
  return `// AutoJs6 · 锚点 [x, y, "#RRGGBB"]
const anchor = [${x}, ${y}, "${colorStr}"];

const img = captureScreen();

// 1) 校验锚点颜色是否一致
const px = images.pixel(img, anchor[0], anchor[1]);
console.log(colors.toString(px)); // 期望 ${colorStr}

// 2) 全屏（或指定区域）找色，返回 { x, y } 或 null
${props.restrict ? 'const region = [0, 0, 0, 0]; // 替换为你的区域\n' : ''}const p = images.findColor(img, anchor[2], ${opts});
if (p) {
    toastLog(\`找到锚点：\${p.x}, \${p.y}\`);
    click(p.x, p.y);
}`
})

async function copyPoint(m) {
  const ok = await copyText(`[${m.x}, ${m.y}]`)
  ok ? ElMessage.success(`已复制 [${m.x}, ${m.y}]`) : ElMessage.error('复制失败')
}
</script>

<style scoped>
.anchor-box {
  display: flex;
  gap: 10px;
  margin-bottom: 8px;
  padding: 10px;
  border: 1px solid var(--app-border);
  border-radius: 10px;
  background: #fbfcfe;
}

.anchor-swatch {
  width: 54px;
  height: 64px;
  border-radius: 8px;
  flex: 0 0 auto;
  position: relative;
  border: 1px solid rgba(15, 23, 42, 0.12);
  padding: 0;
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
}

.anchor-swatch:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 10px rgba(15, 23, 42, 0.14);
}

.anchor-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 3px;
}

.anchor-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
  min-width: 0;
}

.anchor-row .k {
  color: #94a3b8;
  font-size: 11px;
  width: 30px;
  flex: 0 0 30px;
}

.anchor-row b {
  color: #1e293b;
  font-weight: 600;
  font-size: 12px;
}

.color-text {
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.color-text:hover {
  color: #0b8480;
}

.fmt-btn {
  margin-left: auto;
  flex: 0 0 auto;
  font-family: var(--app-mono);
  font-size: 10px;
  line-height: 1;
  padding: 3px 6px;
  border-radius: 5px;
  border: 1px solid #d9e2ec;
  background: #fff;
  color: #64748b;
  cursor: pointer;
  transition: all 0.15s;
}

.fmt-btn:hover {
  border-color: #0ea5a0;
  color: #0b8480;
  background: #eef8f8;
}

.color-hint {
  margin-bottom: 10px;
}

.slider-row :deep(.el-slider) {
  margin: 0 8px;
}

.row-actions {
  display: flex;
  gap: 6px;
  margin: 10px 0;
}

.row-actions .el-button {
  margin-left: 0;
}

.result-box {
  background: #f8fafc;
  border: 1px solid #eef2f7;
  border-radius: 10px;
  padding: 9px 10px;
  margin-bottom: 12px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.result-line {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: #64748b;
}

.result-line .el-icon {
  color: #0ea5a0;
  font-size: 12px;
}

.result-line b {
  color: #1e293b;
}

.match-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 3px;
  align-items: center;
}

.match-tag {
  border: 1px solid #d9e2ec;
  background: #fff;
  color: #475569;
  font-size: 10.5px;
  padding: 2px 6px;
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.15s;
}

.match-tag:hover {
  border-color: #0ea5a0;
  color: #0b8480;
  background: #eef8f8;
}

.match-tag.first {
  border-color: #f97316;
  color: #c2410c;
  background: #fff7ed;
  font-weight: 600;
}

.more {
  font-size: 10.5px;
  color: #94a3b8;
}

.hover-tip {
  margin-top: 8px;
  padding-top: 7px;
  border-top: 1px dashed #e2e8f0;
  color: #94a3b8;
  font-size: 11px;
  line-height: 1.9;
}
</style>
