<template>
  <el-dialog
    :model-value="modelValue"
    width="660px"
    top="7vh"
    append-to-body
    class="settings-dialog"
    :show-close="true"
    @update:model-value="(v) => emit('update:modelValue', v)"
  >
    <template #header>
      <div class="dlg-head">
        <span class="dlg-icon"><el-icon><Setting /></el-icon></span>
        <div class="dlg-text">
          <div class="dlg-title">设置</div>
          <div class="dlg-sub">通用选项与快捷键帮助</div>
        </div>
      </div>
    </template>

    <el-tabs v-model="tab" class="dlg-tabs">
      <el-tab-pane label="通用" name="general">
        <div class="set-row">
          <div class="set-text">
            <div class="set-label">画面工具栏</div>
            <div class="set-desc">画面上方浮动的模式 / 缩放工具条是否显示（任何时候都能用 T 键切换）</div>
          </div>
          <el-switch :model-value="toolbar" @update:model-value="(v) => emit('update:toolbar', v)" />
        </div>

        <div class="set-row">
          <div class="set-text">
            <div class="set-label">取消框选后恢复实时</div>
            <div class="set-desc">按 Esc / Delete 或点「清空」移除区域时，自动解除画面冻结、恢复实时刷新（默认关闭）</div>
          </div>
          <el-switch :model-value="resumeOnClear" @update:model-value="(v) => emit('update:resumeOnClear', v)" />
        </div>

        <div class="set-row">
          <div class="set-text">
            <div class="set-label">颜色格式</div>
            <div class="set-desc">锚点取色时按 C 复制出来的文本格式，按 Shift 可临时切换</div>
          </div>
          <el-select
            :model-value="colorFormat"
            size="small"
            class="fmt-select"
            @update:model-value="(v) => emit('update:colorFormat', v)"
          >
            <el-option v-for="f in COLOR_FORMATS" :key="f.key" :label="`${f.label} · ${f.example}`" :value="f.key" />
          </el-select>
        </div>

        <div class="set-row">
          <div class="set-text">
            <div class="set-label">坐标格式</div>
            <div class="set-desc">
              区域框选时按 C 复制光标当前坐标：未框选 w / h 为 0，框选后带真实宽高；Shift 循环切换
            </div>
          </div>
          <el-select
            :model-value="coordFormat"
            size="small"
            class="fmt-select"
            @update:model-value="(v) => emit('update:coordFormat', v)"
          >
            <el-option
              v-for="f in COORD_FORMATS"
              :key="f.key"
              :label="f.example ? `${f.label} · ${f.example}` : f.label"
              :value="f.key"
            />
          </el-select>
        </div>

        <div v-if="coordFormatKey === 'custom'" class="set-block">
          <div class="set-text">
            <div class="set-label">自定义模板</div>
            <div class="set-desc">
              在这里写出要复制的代码，占位符会替换成实际数值，原样输出（不会执行）：
              <span class="ph-list">
                <span v-for="p in COORD_PLACEHOLDERS" :key="p.key" class="ph mono" :title="p.desc">{{ p.key }}</span>
              </span>
            </div>
          </div>
          <el-input
            :model-value="coordTemplate"
            type="textarea"
            :rows="2"
            resize="none"
            class="tpl-input"
            placeholder="在此填写坐标模板…"
            @update:model-value="(v) => emit('update:coordTemplate', v)"
          />
          <div class="tpl-foot">
            <span v-if="!coordTemplate" class="tpl-hint">模板为空时按 C 不会复制任何内容</span>
            <span v-else class="tpl-hint">按 C 会按此模板复制</span>
            <el-button
              v-if="coordTemplate"
              link
              size="small"
              type="primary"
              @click="emit('update:coordTemplate', '')"
            >
              清空
            </el-button>
          </div>
        </div>

        <div class="about-box">
          <div class="about-row">
            <span>ADB</span>
            <b class="mono">{{ env?.version || env?.error || '未检测到 adb' }}</b>
          </div>
          <div v-if="env?.adbPath" class="about-row">
            <span>路径</span>
            <b class="mono ellipsis">{{ env.adbPath }}</b>
          </div>
          <div v-if="env?.node" class="about-row">
            <span>运行时</span>
            <b class="mono">{{ env.platform }} · Node {{ env.node }}</b>
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="帮助 · 快捷键" name="help">
        <div class="help-intro">
          把鼠标放到画面里再按键即可生效；<span class="mono">Ctrl</span> 与 <span class="mono">⌘</span> 通用。
        </div>
        <div class="help-scroll">
          <section v-for="group in SHORTCUTS" :key="group.group" class="help-group">
            <h4>{{ group.group }}</h4>
            <div v-for="item in group.items" :key="item.desc" class="help-item">
              <span class="help-keys">
                <template v-for="(k, i) in item.keys" :key="`${k}-${i}`">
                  <span v-if="i > 0" class="help-plus">+</span>
                  <span class="kbd">{{ k }}</span>
                </template>
              </span>
              <span class="help-desc">{{ item.desc }}</span>
            </div>
          </section>
        </div>
      </el-tab-pane>
    </el-tabs>
  </el-dialog>
</template>

<script setup>
import { computed, ref } from 'vue'
import { COLOR_FORMATS } from '../utils/color'
import {
  COORD_FORMATS,
  COORD_PLACEHOLDERS,
  DEFAULT_COORD_TEMPLATE,
  normalizeCoordFormat,
} from '../utils/coord'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  toolbar: { type: Boolean, default: true },
  colorFormat: { type: String, default: 'hex' },
  coordFormat: { type: String, default: 'bracket' },
  coordTemplate: { type: String, default: DEFAULT_COORD_TEMPLATE },
  resumeOnClear: { type: Boolean, default: false },
  env: { type: Object, default: null },
})

const emit = defineEmits(['update:modelValue', 'update:toolbar', 'update:colorFormat', 'update:coordFormat', 'update:coordTemplate', 'update:resumeOnClear'])

const tab = ref('general')

const coordFormatKey = computed(() => normalizeCoordFormat(props.coordFormat))

const SHORTCUTS = [
  {
    group: '视图与缩放',
    items: [
      { keys: ['Ctrl', '滚轮'], desc: '放大 / 缩小画面' },
      { keys: ['+'], desc: '放大一级' },
      { keys: ['-'], desc: '缩小一级' },
      { keys: ['F'], desc: '适应屏幕（整屏刚好放进画面区域）' },
      { keys: ['0'], desc: '适应屏幕（同 F）' },
      { keys: ['O'], desc: '原画 1:1，并切换到原画传输' },
      { keys: ['H'], desc: '平移模式开关' },
      { keys: ['G'], desc: '坐标网格开关' },
      { keys: ['右键拖动'], desc: '平移画面（空格 / Alt + 拖动同样可用）' },
      { keys: ['T'], desc: '显示 / 隐藏画面工具栏' },
    ],
  },
  {
    group: '区域框选',
    items: [
      { keys: ['拖拽'], desc: '拖出一个新区域' },
      { keys: ['框内拖动'], desc: '整体移动区域' },
      { keys: ['拖动边角'], desc: '缩放区域（八向控制点）' },
      { keys: ['↑ ↓ ← →'], desc: '区域微调 1px' },
      { keys: ['Shift', '↑ ↓ ← →'], desc: '区域微调 10px' },
      { keys: ['P'], desc: '开始 / 结束中心点偏移取点' },
      { keys: ['C'], desc: '复制光标当前坐标：未框选为 [x, y, 0, 0]，框选后带上真实 w / h' },
      { keys: ['Shift'], desc: '切换坐标格式：带括号 [x, y, w, h] / 不带括号 x, y, w, h / 自定义模板' },
      { keys: ['Esc'], desc: '结束取点，或清除当前区域' },
      { keys: ['Delete'], desc: '清除当前区域' },
    ],
  },
  {
    group: '锚点取色',
    items: [
      { keys: ['单击'], desc: '拾取锚点颜色并全屏找色' },
      { keys: ['C'], desc: '复制当前颜色：光标下的像素即可，不必先点击' },
      { keys: ['Shift'], desc: '切换颜色格式（悬停时同样可用）：#ffffff / rgb() / 0xffffff' },
      { keys: ['↑ ↓ ← →'], desc: '锚点微调 1px，Shift 为 10px' },
    ],
  },
  {
    group: '画面与截图',
    items: [
      { keys: ['1'], desc: '切换到区域框选' },
      { keys: ['2'], desc: '切换到锚点取色' },
      { keys: ['R'], desc: '恢复实时画面' },
      { keys: ['Ctrl', 'S'], desc: '保存截图（有区域存区域，否则整屏）' },
      { keys: ['Ctrl', 'C'], desc: '复制截图到剪贴板（有区域复制区域）' },
      { keys: ['拖入图片'], desc: '把本地图片拖到画面即可切换为图片模式' },
    ],
  },
]
</script>

<style scoped>
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

.dlg-text {
  min-width: 0;
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

.dlg-tabs {
  margin-top: -4px;
}

.set-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 12px;
  border: 1px solid var(--app-border);
  border-radius: 10px;
  margin-bottom: 8px;
  background: #fbfcfe;
}

.set-text {
  min-width: 0;
  flex: 1;
}

.set-label {
  font-size: 13px;
  font-weight: 600;
  color: #1e293b;
}

.set-desc {
  font-size: 11.5px;
  color: #94a3b8;
  line-height: 1.5;
  margin-top: 2px;
}

.fmt-select {
  width: 168px;
  flex: 0 0 168px;
}

/* 自定义坐标模板 */
.set-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--app-border);
  border-radius: 10px;
  margin-bottom: 8px;
  background: #fbfcfe;
}

.ph-list {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}

.ph {
  font-size: 10.5px;
  line-height: 1;
  padding: 3px 5px;
  border-radius: 4px;
  background: #eef8f8;
  color: #0b8480;
  border: 1px solid #d5eeed;
  cursor: help;
}

.tpl-input :deep(.el-textarea__inner) {
  font-family: var(--app-mono);
  font-size: 11.5px;
  line-height: 1.6;
}

.tpl-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11px;
  color: #94a3b8;
  min-width: 0;
}

.tpl-hint {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #cbd5e1;
}

.about-box {
  margin-top: 10px;
  padding: 9px 12px;
  border-radius: 10px;
  background: #f8fafc;
  border: 1px dashed #e2e8f0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.about-row {
  display: flex;
  gap: 10px;
  font-size: 11.5px;
  min-width: 0;
}

.about-row span {
  color: #94a3b8;
  flex: 0 0 44px;
}

.about-row b {
  color: #475569;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.help-intro {
  font-size: 11.5px;
  color: #94a3b8;
  margin-bottom: 8px;
}

.help-scroll {
  max-height: 56vh;
  overflow-y: auto;
  padding-right: 4px;
}

.help-group {
  margin-bottom: 14px;
}

.help-group h4 {
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 700;
  color: #0b8480;
  letter-spacing: 0.3px;
}

.help-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 8px;
  border-radius: 7px;
}

.help-item:nth-child(even) {
  background: #fafbfd;
}

.help-keys {
  flex: 0 0 168px;
  display: flex;
  align-items: center;
  gap: 3px;
  flex-wrap: wrap;
}

.help-plus {
  color: #cbd5e1;
  font-size: 10px;
}

.help-desc {
  font-size: 12px;
  color: #475569;
}
</style>
