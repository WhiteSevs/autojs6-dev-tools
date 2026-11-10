<template>
  <div class="panel-card">
    <div class="panel-head">
      <span class="panel-head-icon"><el-icon><Crop /></el-icon></span>
      <span class="panel-title">区域坐标</span>
      <span class="panel-head-extra">
        <el-tag v-if="region" size="small" type="success" effect="light" round class="mono">
          {{ region.w }} × {{ region.h }}
        </el-tag>
      </span>
    </div>

    <template v-if="region">
      <div class="grid2">
        <div class="num-field">
          <label>x</label>
          <el-input-number
            :model-value="region.x"
            :min="0"
            :max="Math.max(0, deviceW - 1)"
            :controls="false"
            size="small"
            @update:model-value="(v) => patch('x', v)"
          />
        </div>
        <div class="num-field">
          <label>y</label>
          <el-input-number
            :model-value="region.y"
            :min="0"
            :max="Math.max(0, deviceH - 1)"
            :controls="false"
            size="small"
            @update:model-value="(v) => patch('y', v)"
          />
        </div>
        <div class="num-field">
          <label>w</label>
          <el-input-number
            :model-value="region.w"
            :min="1"
            :max="Math.max(1, deviceW - region.x)"
            :controls="false"
            size="small"
            @update:model-value="(v) => patch('w', v)"
          />
        </div>
        <div class="num-field">
          <label>h</label>
          <el-input-number
            :model-value="region.h"
            :min="1"
            :max="Math.max(1, deviceH - region.y)"
            :controls="false"
            size="small"
            @update:model-value="(v) => patch('h', v)"
          />
        </div>
      </div>

      <div class="metrics">
        <div class="metric">
          <span>中心点</span>
          <b class="mono">{{ center.x }}, {{ center.y }}</b>
        </div>
        <div class="metric">
          <span>面积</span>
          <b class="mono">{{ (region.w * region.h).toLocaleString() }}</b>
        </div>
        <div class="metric">
          <span>占屏</span>
          <b class="mono">{{ ratio }}%</b>
        </div>
      </div>

      <div class="row-actions">
        <el-button size="small" @click="emit('update:region', { x: 0, y: 0, w: deviceW, h: deviceH })">
          全屏
        </el-button>
        <el-button size="small" @click="emit('update:region', null)">清空</el-button>
        <el-button size="small" type="primary" plain @click="copyArray">
          <el-icon><CopyDocument /></el-icon>&nbsp;复制坐标
        </el-button>
      </div>

      <div class="row-actions">
        <el-tooltip content="保存框选区域 PNG（Ctrl / ⌘ + S）" placement="top">
          <el-button size="small" type="success" plain :loading="saving === 'png'" @click="saveRegion">
            <el-icon><Download /></el-icon>&nbsp;保存区域图
          </el-button>
        </el-tooltip>
        <el-tooltip content="把框选区域复制到剪贴板（Ctrl / ⌘ + C）" placement="top">
          <el-button size="small" :loading="saving === 'copy'" @click="copyRegion">复制图片</el-button>
        </el-tooltip>
      </div>
      <div class="hint-text" style="margin-bottom: 10px">
        按设备原始像素 1:1 导出 PNG（无损），可直接作为 AutoJs6 <span class="mono">images.findImage</span> 的模板素材。
      </div>

      <CodeCard title="AutoJs6 · 区域用法" :code="code" />
    </template>

    <div v-else class="empty-hint">
      在左侧画面上按住拖拽即可框选区域<br />
      松开后可拖动边角精确调整，得到 x / y / w / h
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import CodeCard from './CodeCard.vue'
import { copyImageToClipboard, copyText, downloadBlob, shotBlob } from '../api'

const props = defineProps({
  region: { type: Object, default: null },
  deviceW: { type: Number, default: 0 },
  deviceH: { type: Number, default: 0 },
  serial: { type: String, default: '' },
  frameId: { type: Number, default: null },
})

const emit = defineEmits(['update:region'])
const saving = ref('')

const center = computed(() =>
  props.region
    ? { x: Math.round(props.region.x + props.region.w / 2), y: Math.round(props.region.y + props.region.h / 2) }
    : { x: 0, y: 0 },
)

const ratio = computed(() => {
  if (!props.region || !props.deviceW || !props.deviceH) return '0.0'
  const r = (props.region.w * props.region.h) / (props.deviceW * props.deviceH)
  return (r * 100).toFixed(1)
})

const code = computed(() => {
  if (!props.region) return ''
  const { x, y, w, h } = props.region
  return `// AutoJs6 · 区域 [x, y, w, h]
const region = [${x}, ${y}, ${w}, ${h}];

// 1) 裁剪该区域（后续可做模板匹配 / 找色）
const clip = images.clip(captureScreen(), ...region);

// 2) 点击区域中心
click(region[0] + Math.floor(region[2] / 2), region[1] + Math.floor(region[3] / 2));

// 3) 限定在该区域内找色，速度更快
const p = images.findColor(captureScreen(), "#FF6B2C", { region, threshold: 8 });`
})

function patch(key, value) {
  if (!props.region || !Number.isFinite(Number(value))) return
  const next = { ...props.region, [key]: Math.round(Number(value)) }
  next.w = Math.min(next.w, props.deviceW - next.x || 1)
  next.h = Math.min(next.h, props.deviceH - next.y || 1)
  emit('update:region', next)
}

async function copyArray() {
  const ok = await copyText(`[${props.region.x}, ${props.region.y}, ${props.region.w}, ${props.region.h}]`)
  ok ? ElMessage.success('[x, y, w, h] 已复制') : ElMessage.error('复制失败')
}

function regionName() {
  const r = props.region
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  return `region-${r.x},${r.y}-${r.w}x${r.h}-${stamp}.png`
}

async function saveRegion() {
  if (!props.region || saving.value) return
  saving.value = 'png'
  try {
    const blob = await shotBlob({
      serial: props.serial,
      frameId: props.frameId,
      region: props.region,
    })
    downloadBlob(blob, regionName())
    ElMessage.success(`已保存 ${props.region.w} × ${props.region.h} 区域图（PNG 无损）`)
  } catch (err) {
    ElMessage.error(`保存失败：${err.message}`)
  } finally {
    saving.value = ''
  }
}

async function copyRegion() {
  if (!props.region || saving.value) return
  saving.value = 'copy'
  try {
    // 直接把请求 Promise 交给剪贴板，避免 await 网络后丢失用户手势
    await copyImageToClipboard(
      shotBlob({
        serial: props.serial,
        frameId: props.frameId,
        region: props.region,
      }),
    )
    ElMessage.success('区域图已复制到剪贴板')
  } catch (err) {
    ElMessage.error(`复制图片失败：${err.message}`)
  } finally {
    saving.value = ''
  }
}
</script>

<style scoped>
.grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 10px;
}

.num-field {
  display: flex;
  align-items: center;
  gap: 6px;
}

.num-field label {
  font-family: var(--app-mono);
  font-size: 12px;
  color: #0ea5a0;
  font-weight: 700;
  width: 12px;
  text-align: center;
}

.num-field :deep(.el-input-number) {
  flex: 1;
  width: 100%;
}

.num-field :deep(.el-input__inner) {
  font-family: var(--app-mono);
  text-align: left;
  font-size: 12.5px;
}

.metrics {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
}

.metric {
  flex: 1;
  background: #f8fafc;
  border: 1px solid #eef2f7;
  border-radius: 8px;
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.metric span {
  font-size: 10.5px;
  color: #94a3b8;
}

.metric b {
  font-size: 12px;
  color: #1e293b;
  font-weight: 600;
}

.row-actions {
  display: flex;
  gap: 6px;
  margin-bottom: 12px;
}

.row-actions .el-button {
  flex: 0 0 auto;
  margin-left: 0;
}

.row-actions .el-button:last-child {
  margin-left: auto;
}
</style>
