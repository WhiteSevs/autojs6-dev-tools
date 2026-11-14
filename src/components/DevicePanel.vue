<template>
  <div class="panel-card">
    <div class="panel-head">
      <span class="panel-head-icon"><el-icon><Iphone /></el-icon></span>
      <span class="panel-title">设备与操作</span>
      <span class="panel-head-extra">
        <el-tag v-if="info?.demo" size="small" type="info" effect="plain" round>演示</el-tag>
      </span>
    </div>

    <div class="info-grid">
      <div class="info-item">
        <span>型号</span>
        <b>{{ info?.model || '—' }}</b>
      </div>
      <div class="info-item">
        <span>Android</span>
        <b>{{ info?.androidVersion || '—' }}<em v-if="info?.sdk"> · API {{ info.sdk }}</em></b>
      </div>
      <div class="info-item">
        <span>分辨率</span>
        <b class="mono">{{ info?.screen?.width || 0 }} × {{ info?.screen?.height || 0 }}</b>
      </div>
      <div class="info-item">
        <span>密度</span>
        <b class="mono">{{ info?.density || '—' }} dpi</b>
      </div>
    </div>

    <div class="op-row">
      <el-button size="small" :loading="saving" @click="saveShot">
        <el-icon><Download /></el-icon>&nbsp;保存整屏
      </el-button>
      <el-button size="small" :disabled="!anchor || isDemo" @click="tapAnchor">
        <el-icon><Pointer /></el-icon>&nbsp;点击锚点
      </el-button>
      <el-button size="small" :disabled="isDemo" @click="sendKey('back')">返回</el-button>
      <el-button size="small" :disabled="isDemo" @click="sendKey('home')">Home</el-button>
      <el-button size="small" :disabled="isDemo" @click="sendKey('recents')">任务</el-button>
    </div>

    <div class="touch-block" :class="{ enabled: recordMode, active: liveTouch }">
      <div class="touch-head">
        <span class="touch-title">
          <el-icon><Position /></el-icon>
          远程触控
        </span>
        <span class="touch-hint">
          {{ recordMode ? '在画面上点 / 按住 / 拖动，直接操作真机' : '切到「录屏」画面后可用' }}
        </span>
      </div>
      <div class="op-row">
        <el-button
          size="small"
          :type="liveTouch ? 'primary' : ''"
          :plain="!liveTouch"
          :disabled="!recordMode"
          @click="toggleLiveTouch"
        >
          <el-icon><Pointer /></el-icon>&nbsp;实时点击
        </el-button>
        <el-button v-if="liveTouch" size="small" text @click="emit('update:liveTouch', false)">退出触控</el-button>
      </div>
      <div v-if="liveTouch" class="touch-tips">
        按下 = 按下 · 拖动实时跟随 · 松开 = 抬起
      </div>
    </div>

    <div class="hint-text">
      提示：坐标与颜色均基于设备物理像素；若脚本在真机运行结果与预览不一致，请确认 AutoJs6 的
      <span class="mono">device.width</span> 与上方分辨率相同。
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api, downloadBlob, shotBlob } from '../api'

const props = defineProps({
  serial: { type: String, default: '' },
  info: { type: Object, default: null },
  anchor: { type: Object, default: null },
  /** 是否处于录屏画面：远程触控只在实时画面下有意义 */
  recordMode: { type: Boolean, default: false },
  /** 远程触控开关 */
  liveTouch: { type: Boolean, default: false },
})

const emit = defineEmits(['update:liveTouch'])

const isDemo = computed(() => props.serial === 'demo' || props.info?.demo)
const saving = ref(false)

function toggleLiveTouch() {
  emit('update:liveTouch', !props.liveTouch)
}

async function saveShot() {
  if (saving.value) return
  saving.value = true
  try {
    const blob = await shotBlob({ serial: props.serial || 'demo', fresh: true })
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
    downloadBlob(blob, `screenshot-${props.serial || 'demo'}-${stamp}.png`)
    ElMessage.success('已保存整屏截图（原始像素）')
  } catch (err) {
    ElMessage.error(`保存失败：${err.message}`)
  } finally {
    saving.value = false
  }
}

async function tapAnchor() {
  if (!props.anchor) return
  try {
    const r = await api.tap(props.serial, props.anchor.x, props.anchor.y)
    ElMessage.success(r.message || '已发送点击')
  } catch (err) {
    ElMessage.error(err.message)
  }
}

async function sendKey(key) {
  try {
    const r = await api.key(props.serial, key)
    ElMessage.success(r.message || `已发送 ${key}`)
  } catch (err) {
    ElMessage.error(err.message)
  }
}
</script>

<style scoped>
.touch-block {
  margin-bottom: 10px;
  padding: 8px 9px;
  border: 1px dashed #dbe3ec;
  border-radius: 9px;
  background: #fbfdff;
  transition: border-color 0.15s, background 0.15s;
}

.touch-block.enabled {
  border-color: #c7e9e7;
  background: #f6fbfb;
}

.touch-block.active {
  border-style: solid;
  border-color: #0ea5a0;
  background: #eef8f8;
}

.touch-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 7px;
}

.touch-title {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  color: #0f172a;
  white-space: nowrap;
}

.touch-hint {
  font-size: 11px;
  color: #94a3b8;
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.touch-block .op-row {
  margin-bottom: 0;
}

.touch-tips {
  margin-top: 6px;
  font-size: 11px;
  color: #0b8480;
  background: #e7f6f5;
  border-radius: 6px;
  padding: 4px 8px;
  line-height: 1.5;
}

.info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-bottom: 10px;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: #f8fafc;
  border: 1px solid #eef2f7;
  border-radius: 8px;
  padding: 6px 9px;
  min-width: 0;
}

.info-item span {
  font-size: 10.5px;
  color: #94a3b8;
}

.info-item b {
  font-size: 12px;
  color: #1e293b;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.info-item em {
  font-style: normal;
  color: #94a3b8;
  font-weight: 400;
}

.op-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}

.op-row .el-button {
  margin-left: 0;
}
</style>
