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
      <el-tooltip content="按设备原始像素保存整屏（Ctrl / ⌘ + S）" placement="top">
        <el-button size="small" :loading="saving" @click="saveShot">
          <el-icon><Download /></el-icon>&nbsp;保存整屏
        </el-button>
      </el-tooltip>
      <el-tooltip :content="anchor ? `点击 ${anchor.x}, ${anchor.y}` : '先在画面上拾取锚点'" placement="top">
        <el-button size="small" :disabled="!anchor || isDemo" @click="tapAnchor">
          <el-icon><Pointer /></el-icon>&nbsp;点击锚点
        </el-button>
      </el-tooltip>
      <el-button size="small" :disabled="isDemo" @click="sendKey('back')">返回</el-button>
      <el-button size="small" :disabled="isDemo" @click="sendKey('home')">Home</el-button>
      <el-button size="small" :disabled="isDemo" @click="sendKey('recents')">任务</el-button>
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
})

const isDemo = computed(() => props.serial === 'demo' || props.info?.demo)
const saving = ref(false)

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
