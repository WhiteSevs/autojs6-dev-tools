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

    <template v-if="anchor">
      <div class="anchor-box">
        <div class="anchor-swatch" :style="{ background: color || anchor.hex }">
          <span class="anchor-hex">{{ color || anchor.hex }}</span>
        </div>
        <div class="anchor-info">
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
      切换到「锚点取色」模式，在画面上单击<br />
      即可读取该点的精确颜色与坐标
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { ElMessage } from 'element-plus'
import CodeCard from './CodeCard.vue'
import { copyText } from '../api'

const props = defineProps({
  anchor: { type: Object, default: null },
  color: { type: String, default: '' },
  threshold: { type: Number, default: 4 },
  restrict: { type: Boolean, default: false },
  hasRegion: { type: Boolean, default: false },
  result: { type: Object, default: null },
  loading: { type: Boolean, default: false },
})

const emit = defineEmits(['update:color', 'update:threshold', 'update:restrict', 'find', 'clear'])

const decimalHex = computed(() => {
  if (!props.anchor) return '000000'
  return (props.anchor.decimal ?? 0).toString(16).toUpperCase().padStart(6, '0')
})

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
  margin-bottom: 10px;
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
  display: flex;
  align-items: flex-end;
  justify-content: center;
  overflow: hidden;
}

.anchor-hex {
  width: 100%;
  text-align: center;
  font-family: var(--app-mono);
  font-size: 9px;
  padding: 2px 0;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  letter-spacing: 0.2px;
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
</style>
