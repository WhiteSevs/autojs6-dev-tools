<template>
  <div class="code-card">
    <div class="code-head">
      <span class="code-title">{{ title }}</span>
      <el-button link size="small" :type="copied ? 'success' : 'primary'" @click="doCopy">
        <el-icon><component :is="copied ? 'CircleCheck' : 'CopyDocument'" /></el-icon>
        <span style="margin-left: 4px">{{ copied ? '已复制' : '复制' }}</span>
      </el-button>
    </div>
    <div class="code-box">
      <pre v-html="highlighted" />
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { copyText } from '../api'

const props = defineProps({
  title: { type: String, default: 'AutoJs6 代码' },
  code: { type: String, default: '' },
})

const copied = ref(false)

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// 单次扫描：字符串 / 注释 / 关键字 / 数字 / API，避免二次替换命中注入的标签属性
const TOKEN =
  /("(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)|(\/\/[^\n]*)|(\b(?:const|let|var|function|if|else|return|for|while|await|async|new|typeof|true|false|null|undefined)\b)|(\b\d+(?:\.\d+)?\b)|(\b(?:images|colors|device|console|click|toastLog|captureScreen|sleep)\.[A-Za-z_$][\w$]*)/g

function highlight(code) {
  return escapeHtml(code).replace(TOKEN, (match, str, cmt, kw, num, apiName) => {
    if (str) return `<span class="tk-str">${str}</span>`
    if (cmt) return `<span class="tk-cm">${cmt}</span>`
    if (kw) return `<span class="tk-kw">${kw}</span>`
    if (num) return `<span class="tk-num">${num}</span>`
    if (apiName) return `<span class="tk-api">${apiName}</span>`
    return match
  })
}

const highlighted = computed(() => highlight(props.code))

async function doCopy() {
  const ok = await copyText(props.code)
  if (ok) {
    copied.value = true
    ElMessage.success({ message: '代码已复制到剪贴板', duration: 1200 })
    setTimeout(() => (copied.value = false), 1400)
  } else {
    ElMessage.error('复制失败，请手动选择文本复制')
  }
}
</script>

<style scoped>
.code-card {
  border: 1px solid var(--app-border);
  border-radius: 10px;
  overflow: hidden;
  background: #fff;
}

.code-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 6px 4px 10px;
  background: #f8fafc;
  border-bottom: 1px solid var(--app-border);
}

.code-title {
  font-size: 11.5px;
  color: #64748b;
  font-weight: 600;
  letter-spacing: 0.2px;
}

.code-card :deep(.code-box) {
  border-radius: 0;
  max-height: 280px;
}

.code-card :deep(.tk-cm) {
  color: #64748b;
  font-style: italic;
}

.code-card :deep(.tk-str) {
  color: #86efac;
}

.code-card :deep(.tk-kw) {
  color: #c4b5fd;
}

.code-card :deep(.tk-num) {
  color: #fdba74;
}

.code-card :deep(.tk-api) {
  color: #7dd3fc;
}
</style>
