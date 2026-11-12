<template>
  <div class="app-shell" :class="{ 'rail-collapsed': railCollapsed }">
    <!-- 顶栏 / 侧栏（宽大于高时自动变成左侧竖栏） -->
    <header class="topbar">
      <div class="brand">
        <div class="brand-logo">
          <el-icon :size="18"><Aim /></el-icon>
        </div>
        <div class="brand-text">
          <div class="brand-title">AutoJs6 开发助手</div>
          <div class="brand-sub">ADB 实时画面 · 区域坐标 · 锚点取色</div>
        </div>
        <el-tooltip :content="railCollapsed ? '展开侧栏' : '收起侧栏'" placement="right">
          <button class="rail-toggle" @click="toggleRail">
            <el-icon><component :is="railCollapsed ? 'DArrowRight' : 'DArrowLeft'" /></el-icon>
          </button>
        </el-tooltip>
      </div>

      <div class="topbar-divider" />

      <div class="hb-group">
        <span class="topbar-label hb-title">数据源</span>
        <div class="hb-seg">
          <button :class="{ active: !imageMode }" @click="setSource('device')">
            <el-icon><Iphone /></el-icon><span class="btn-text">设备</span>
          </button>
          <button :class="{ active: imageMode }" @click="setSource('image')">
            <el-icon><Picture /></el-icon><span class="btn-text">图片</span>
          </button>
        </div>
      </div>

      <div class="topbar-divider" />

      <!-- 数据源：设备 -->
      <div v-if="!imageMode" class="hb-group">
        <span class="topbar-label hb-title">设备</span>
        <div class="hb-row">
          <el-select
            v-model="serial"
            class="device-select"
            size="default"
            :loading="loadingDevices"
            placeholder="选择设备"
            no-data-text="未检测到设备"
          >
            <el-option v-for="d in devices" :key="d.serial" :label="d.label" :value="d.serial">
              <div class="opt-row">
                <span class="opt-dot" :class="d.state" />
                <span class="opt-name">{{ d.model || d.serial }}</span>
                <span class="opt-meta mono">{{ d.serial }}</span>
              </div>
            </el-option>
            <template #prefix>
              <el-icon><Iphone /></el-icon>
            </template>
          </el-select>

          <div class="hb-btns">
            <el-tooltip content="刷新设备列表" :placement="tipPlacement">
              <el-button :loading="loadingDevices" circle @click="refreshDevices">
                <el-icon v-if="!loadingDevices"><Refresh /></el-icon>
              </el-button>
            </el-tooltip>

            <el-popover placement="bottom-start" :width="286" trigger="click">
              <template #reference>
                <el-button>
                  <el-icon><Connection /></el-icon>
                  <span class="btn-text">&nbsp;无线连接</span>
                </el-button>
              </template>
              <div class="popover-body">
                <div class="popover-title">通过 Wi-Fi 连接 Android 设备</div>
                <el-input v-model="connectAddr" size="small" placeholder="192.168.1.20:5555" class="mono" />
                <div class="popover-actions">
                  <el-button size="small" type="primary" :loading="connecting" @click="doConnect">连接</el-button>
                  <el-button size="small" @click="connectAddr = ''">清空</el-button>
                </div>
                <div class="hint-text">
                  先在同一局域网下执行 <span class="mono">adb tcpip 5555</span>，或使用 USB 配对后的端口。
                </div>
              </div>
            </el-popover>
          </div>
        </div>
      </div>

      <!-- 数据源：本地图片 -->
      <div v-else class="hb-group">
        <span class="topbar-label hb-title">图片</span>
        <div class="hb-btns">
          <el-button :loading="uploading" @click="openImagePicker">
            <el-icon v-if="!uploading"><Upload /></el-icon>
            <span class="btn-text">&nbsp;{{ imageInfo ? '换一张' : '选择图片' }}</span>
          </el-button>
          <el-tooltip v-if="imageInfo" content="清除当前图片" :placement="tipPlacement">
            <el-button circle @click="clearImage">
              <el-icon><Close /></el-icon>
            </el-button>
          </el-tooltip>
        </div>
        <div v-if="imageInfo" class="img-brief" :title="imageInfo.name">
          <span class="mono">{{ imageInfo.name }}</span>
        </div>
      </div>

      <!-- 画面参数仅对设备实时画面生效，图片模式下整组隐藏 -->
      <template v-if="!imageMode">
        <div class="topbar-divider" />

        <div class="hb-group">
          <span class="topbar-label hb-title">画面</span>
          <div class="hb-fields">
            <div class="hb-field">
              <label>实时</label>
              <el-tooltip :content="frozen ? '恢复实时画面' : '冻结当前画面，便于精确框选'" :placement="tipPlacement">
                <el-switch
                  :model-value="!frozen"
                  inline-prompt
                  active-text="实时"
                  inactive-text="冻结"
                  style="--el-switch-on-color: #0ea5a0"
                  @change="(v) => (v ? resumeLive() : freezeFrame())"
                />
              </el-tooltip>
            </div>

            <div class="hb-field">
              <label>帧率</label>
              <el-select v-model="fps" class="fps-select" size="small">
                <el-option v-for="v in FPS_OPTIONS" :key="v" :label="`${v} fps`" :value="v" />
              </el-select>
            </div>

            <div class="hb-field">
              <label>画质</label>
              <el-select v-model="scale" class="scale-select" size="small">
                <el-option label="原画 1:1" :value="1" />
                <el-option label="高清" :value="2" />
                <el-option label="标准" :value="3" />
                <el-option label="流畅" :value="4" />
              </el-select>
            </div>
          </div>
        </div>
      </template>

      <div class="topbar-spacer" />

      <div class="hb-status">
        <el-tag size="small" :type="adbOk ? 'success' : 'danger'" effect="light" round class="adb-tag">
          <span class="tag-text mono">{{ adbOk ? 'ADB 已就绪' : 'ADB 未就绪' }}</span>
        </el-tag>
        <el-tooltip :content="env?.version || env?.error || '正在检测 adb'" placement="bottom-end">
          <el-icon class="help-dot"><InfoFilled /></el-icon>
        </el-tooltip>
      </div>

      <button class="settings-btn" @click="settingsOpen = true">
        <el-icon><Setting /></el-icon>
        <span class="btn-text">设置</span>
      </button>
    </header>

    <input ref="fileInputRef" type="file" accept="image/*" class="hidden-file" @change="onFileChange" />

    <div class="app-body">
      <!-- 主区 -->
      <div class="workspace">
        <div
          class="stage-panel"
          :class="{ 'drop-active': dragOver }"
          @dragover.prevent="onDragOver"
          @dragleave="onDragLeave"
          @drop.prevent="onDrop"
        >
          <ScreenStage
            v-model:mode="mode"
            v-model:pan-mode="panMode"
            v-model:show-toolbar="showToolbar"
            :bitmap="displayBitmap"
            :meta="displayMeta"
            :region="region"
            :offsets="mode === 'region' ? offsets : []"
            :offset-picking="mode === 'region' && offsetPicking"
            :anchor="mode === 'color' ? anchor : null"
            :matches="mode === 'color' ? matches : []"
            :match-total="mode === 'color' ? findResult?.total || 0 : 0"
            :bbox="mode === 'color' ? bbox : null"
            :frozen="frozen && !imageMode"
            :color-format="colorFormat"
            :click-resume="clickResume"
            :empty-title="imageMode ? '还没有载入图片' : '等待画面…'"
            :empty-desc="
              imageMode ? '点「选择图片」，或把图片直接拖到这个区域' : '正在连接设备并拉取屏幕，稍候片刻'
            "
            @update:region="setRegion"
            @clear-region="clearRegion"
            @update:offset-picking="(v) => (offsetPicking = v)"
            @pick="onPick"
            @pick-offset="onPickOffset"
            @interact="freezeFrame"
            @resume="resumeLive"
            @request-original="ensureOriginal"
            @hover="onHover"
          />
          <div v-if="dragOver" class="drop-mask">
            <el-icon :size="30"><PictureFilled /></el-icon>
            <span>松开鼠标载入图片</span>
          </div>
        </div>

        <aside class="side-panel">
          <RegionPanel
            v-if="mode === 'region'"
            :region="region"
            :offsets="offsets"
            :picking="offsetPicking"
            :device-w="deviceW"
            :device-h="deviceH"
            :serial="activeSerial"
            :frame-id="displayMeta?.frameId"
            :bitmap="displayBitmap"
            :meta="displayMeta"
            @update:region="setRegion"
            @clear-region="clearRegion"
            @interact="freezeFrame"
            @resume="resumeLive"
            @update:offsets="(v) => (offsets = v)"
            @update:picking="(v) => (offsetPicking = v)"
          />
          <ColorPanel
            v-else
            :anchor="anchor"
            :color="searchColor"
            :threshold="threshold"
            :restrict="restrict"
            :has-region="!!region"
            :result="findResult"
            :loading="finding"
            :format="colorFormat"
            @update:color="(v) => (searchColor = v)"
            @update:threshold="onThreshold"
            @update:restrict="onRestrict"
            @update:format="setColorFormat"
            @find="runFind"
            @clear="clearAnchor"
          />
          <DevicePanel v-if="!imageMode" :serial="serial" :info="info" :anchor="anchor" />
          <div v-else class="panel-card">
            <div class="panel-head">
              <span class="panel-head-icon"><el-icon><Picture /></el-icon></span>
              <span class="panel-title">图片信息</span>
              <span class="panel-head-extra">
                <el-tag v-if="imageInfo" size="small" type="info" effect="plain" round class="mono">
                  {{ imageInfo.width }} × {{ imageInfo.height }}
                </el-tag>
              </span>
            </div>
            <template v-if="imageInfo">
              <div class="field-row">
                <span class="field-label">文件</span>
                <span class="field-grow ellipsis" :title="imageInfo.name">{{ imageInfo.name }}</span>
              </div>
              <div class="field-row">
                <span class="field-label">尺寸</span>
                <b class="mono">{{ imageInfo.width }} × {{ imageInfo.height }}</b>
                <span class="hint-text">· {{ formatBytes(imageInfo.size) }}</span>
              </div>
              <div class="field-row">
                <span class="field-label">坐标</span>
                <span class="hint-text">与图片像素 1:1，可直接写进脚本</span>
              </div>
              <div class="op-row">
                <el-button size="small" :loading="uploading" @click="openImagePicker">
                  <el-icon><Picture /></el-icon>&nbsp;换一张
                </el-button>
                <el-tooltip content="保存整张图片（Ctrl / ⌘ + S）" placement="top">
                  <el-button size="small" @click="saveWholeImage">
                    <el-icon><Download /></el-icon>&nbsp;保存整图
                  </el-button>
                </el-tooltip>
                <el-button size="small" @click="setSource('device')">回到设备</el-button>
              </div>
            </template>
            <div v-else class="empty-hint">
              还没有载入图片<br />点上方「选择图片」，或直接把图片拖到左侧画面
            </div>
          </div>
        </aside>
      </div>

      <!-- 状态栏 -->
      <footer class="statusbar">
        <span class="status-main">
          <span class="status-dot" :class="statusDotClass" />
          <b>{{ statusText }}</b>
          <button
            v-if="frozen && !imageMode"
            class="status-action"
            :class="{ danger: frozenReason === 'lost' }"
            @click="onFreezeAction"
          >
            <el-icon>
              <component :is="frozenReason === 'lost' ? 'RefreshRight' : 'VideoPlay'" />
            </el-icon>
            {{ frozenReason === 'lost' ? '重连设备' : '恢复实时' }}
          </button>
        </span>
        <span v-if="env?.version">{{ env.version }}</span>
        <span v-if="!imageMode && serial">serial <b class="mono">{{ serial }}</b></span>
        <span v-if="imageMode && imageInfo">图片 <b class="mono">{{ imageInfo.name }}</b></span>
        <span v-if="displayMeta">
          画面 <b class="mono">{{ displayMeta.deviceWidth }} × {{ displayMeta.deviceHeight }}</b>
          <template v-if="!imageMode"> · 传输 <b class="mono">{{ displayMeta.width }} × {{ displayMeta.height }}</b></template>
        </span>
        <span v-if="displayMeta && !imageMode">
          实际 <b class="mono">{{ displayMeta.fps || 0 }} fps</b> · 单帧 <b class="mono">{{ displayMeta.cost || 0 }}ms</b>
        </span>
        <span v-if="hoverText" class="mono">光标 {{ hoverText }}</span>
        <span v-if="lastError" class="err-text">{{ lastError }}</span>
        <span style="margin-left: auto" v-if="region" class="mono">
          区域 [{{ region.x }}, {{ region.y }}, {{ region.w }}, {{ region.h }}]
          <template v-if="offsetPicking"> · 取点中…</template>
          <template v-else-if="offsets.length"> · 偏移 {{ offsets.length }} 个</template>
        </span>
      </footer>
    </div>

    <SettingsDialog
      v-model="settingsOpen"
      :toolbar="showToolbar"
      :color-format="colorFormat"
      :coord-format="coordFormat"
      :coord-template="coordTemplate"
      :click-resume="clickResume"
      :resume-on-clear="resumeOnClear"
      :env="env"
      @update:toolbar="setToolbarDefault"
      @update:color-format="setColorFormat"
      @update:coord-format="setCoordFormat"
      @update:coord-template="setCoordTemplate"
      @update:click-resume="setClickResume"
      @update:resume-on-clear="setResumeOnClear"
    />
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { ElMessage } from 'element-plus'
import ScreenStage from './components/ScreenStage.vue'
import RegionPanel from './components/RegionPanel.vue'
import ColorPanel from './components/ColorPanel.vue'
import DevicePanel from './components/DevicePanel.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import { useStream } from './composables/useStream'
import { api, copyImageToClipboard, copyText, downloadBlob, shotBlob } from './api'
import { formatColor, formatExample, nextFormat, normalizeFormat } from './utils/color'
import { formatRegionText, parseRegion } from './utils/region'
import {
  DEFAULT_COORD_TEMPLATE,
  coordFormatExample,
  coordFormatLabel,
  formatCoord,
  nextCoordFormat,
  normalizeCoordFormat,
  normalizeCoordTemplate,
} from './utils/coord'

/** 帧率由高到低排列，默认最高帧率 */
const FPS_OPTIONS = [8, 5, 3, 2, 1]

const stream = useStream()
const { bitmap, meta, ready, paused, error: streamError, lost: streamLost } = stream

const env = ref(null)
const devices = ref([])
const serial = ref('')
const info = ref(null)
const loadingDevices = ref(false)
const connecting = ref(false)
const connectAddr = ref('')

const mode = ref('region')
const panMode = ref(false)
const showToolbar = ref(readToolbarDefault())
const railCollapsed = ref(readRailState())
const settingsOpen = ref(false)
const colorFormat = ref(readColorFormat())
const coordFormat = ref(readCoordFormat())
const coordTemplate = ref(readCoordTemplate())
/** 框选冻结后单击画面恢复实时：默认开启 */
const clickResume = ref(readClickResume())
/** 取消框选（Esc / Delete / 清空）后恢复实时：默认关闭 */
const resumeOnClear = ref(readResumeOnClear())

/* 数据源：设备 / 本地图片 */
const imageMode = ref(false)
const imageBitmap = shallowRef(null)
const imageSerial = ref('')
const imageInfo = ref(null) // { name, width, height, size }
const uploading = ref(false)
const dragOver = ref(false)
const fileInputRef = ref(null)

const isLandscape = ref(false)
const tipPlacement = computed(() => (isLandscape.value ? 'top' : 'bottom'))

const imageMeta = computed(() =>
  imageInfo.value
    ? {
        width: imageInfo.value.width,
        height: imageInfo.value.height,
        deviceWidth: imageInfo.value.width,
        deviceHeight: imageInfo.value.height,
        scale: 1,
        fps: 0,
        cost: 0,
      }
    : null,
)

const displayBitmap = computed(() => (imageMode.value ? imageBitmap.value : bitmap.value))
const displayMeta = computed(() => (imageMode.value ? imageMeta.value : meta.value))
const activeSerial = computed(() => (imageMode.value ? imageSerial.value : serial.value))

let landscapeMql = null
function syncLandscape(e) {
  isLandscape.value = e.matches
}

function readRailState() {
  try {
    return localStorage.getItem('autojs6.railCollapsed') === '1'
  } catch {
    return false
  }
}

function readToolbarDefault() {
  try {
    return localStorage.getItem('autojs6.showToolbar') !== '0'
  } catch {
    return true
  }
}

function readColorFormat() {
  try {
    return normalizeFormat(localStorage.getItem('autojs6.colorFormat') || 'hex')
  } catch {
    return 'hex'
  }
}

function readCoordFormat() {
  try {
    return normalizeCoordFormat(localStorage.getItem('autojs6.coordFormat') || 'bracket')
  } catch {
    return 'bracket'
  }
}

function readCoordTemplate() {
  try {
    const saved = localStorage.getItem('autojs6.coordTemplate')
    // 只做一次迁移：早期版本预置过示例模板，之后用户手写的同款模板不再被清掉
    if (localStorage.getItem('autojs6.coordTemplateMigrated') !== '1') {
      const tpl = normalizeCoordTemplate(saved || DEFAULT_COORD_TEMPLATE)
      if (saved !== null && saved !== tpl) localStorage.setItem('autojs6.coordTemplate', tpl)
      localStorage.setItem('autojs6.coordTemplateMigrated', '1')
      return tpl
    }
    return saved ?? DEFAULT_COORD_TEMPLATE
  } catch {
    return DEFAULT_COORD_TEMPLATE
  }
}

function setToolbarDefault(v) {
  showToolbar.value = v
  try {
    localStorage.setItem('autojs6.showToolbar', v ? '1' : '0')
  } catch {}
}

function readClickResume() {
  try {
    return localStorage.getItem('autojs6.clickResumeLive') !== '0'
  } catch {
    return true
  }
}

function setClickResume(v) {
  clickResume.value = !!v
  try {
    localStorage.setItem('autojs6.clickResumeLive', v ? '1' : '0')
  } catch {}
}

function setColorFormat(v) {
  colorFormat.value = normalizeFormat(v)
  try {
    localStorage.setItem('autojs6.colorFormat', colorFormat.value)
  } catch {}
}

function setCoordFormat(v) {
  coordFormat.value = normalizeCoordFormat(v)
  try {
    localStorage.setItem('autojs6.coordFormat', coordFormat.value)
  } catch {}
}

function setCoordTemplate(v) {
  coordTemplate.value = String(v ?? '')
  try {
    localStorage.setItem('autojs6.coordTemplate', coordTemplate.value)
  } catch {}
}

function readResumeOnClear() {
  try {
    return localStorage.getItem('autojs6.resumeOnRegionClear') === '1'
  } catch {
    return false
  }
}

function setResumeOnClear(v) {
  resumeOnClear.value = !!v
  try {
    localStorage.setItem('autojs6.resumeOnRegionClear', resumeOnClear.value ? '1' : '0')
  } catch {}
}

function toggleRail() {
  railCollapsed.value = !railCollapsed.value
  try {
    localStorage.setItem('autojs6.railCollapsed', railCollapsed.value ? '1' : '0')
  } catch {}
}
const region = ref(null)
/* 中心点偏移：都以区域中心为原点，只存相对量，区域移动时偏移跟着走 */
const offsets = ref([])
const offsetPicking = ref(false)
const anchor = ref(null)
const searchColor = ref('')
const threshold = ref(4)
const restrict = ref(false)
const findResult = ref(null)
const finding = ref(false)
const frozen = ref(false)
/** '' | 'manual'（手动冻结） | 'lost'（设备断开，自动冻结并保留最后一帧） */
const frozenReason = ref('')

/**
 * 区域更新入口：ScreenStage 拖拽 / 全屏按钮 / 取点都走这里（不含「取消框选」，
 * 取消走 clearRegion）。这里只做赋值，不做自动恢复，避免「重新框选」时误触发。
 */
function setRegion(v) {
  region.value = v
}

/**
 * 取消框选（Esc / Delete / 右侧「清空」按钮）：
 * 开启「取消框选后恢复实时」且当前处于冻结状态时，自动恢复实时画面。
 */
function clearRegion() {
  region.value = null
  if (resumeOnClear.value && !imageMode.value && frozen.value) {
    resumeLive()
  }
}
const hoverText = ref('')
/** 光标下的像素颜色（锚点取色模式下实时更新，用于悬停即按 C 复制） */
const hoverColor = ref('')
/** 光标下的设备坐标（区域框选模式下按 C 复制用） */
const hoverCoord = ref(null)
const lastError = ref('')

const fps = ref(FPS_OPTIONS[0])
const scale = ref(1)

const adbOk = computed(() => !!env.value?.ok)
const deviceW = computed(() => displayMeta.value?.deviceWidth || info.value?.screen?.width || 0)
const deviceH = computed(() => displayMeta.value?.deviceHeight || info.value?.screen?.height || 0)
const matches = computed(() => findResult.value?.matches || [])
const bbox = computed(() => findResult.value?.bbox || null)

const statusText = computed(() => {
  if (imageMode.value) {
    return imageInfo.value ? `图片模式 · ${imageInfo.value.name}` : '图片模式 · 未载入图片'
  }
  if (frozenReason.value === 'lost') return '设备已断开 · 已冻结最后一帧'
  if (streamError.value) return streamError.value
  if (!adbOk.value) return '未检测到 adb'
  if (!serial.value) return '未选择设备'
  if (frozen.value) return '已冻结画面'
  if (!ready.value) return '正在连接画面…'
  return serial.value === 'demo' ? '演示模式' : '实时投屏中'
})

const statusDotClass = computed(() => {
  if (imageMode.value) return imageInfo.value ? 'on' : 'warn'
  if (frozenReason.value === 'lost') return 'err'
  if (streamError.value || !adbOk.value) return 'err'
  if (frozen.value) return 'warn'
  return ready.value ? 'on' : ''
})

/* ------------------------------ 设备 ------------------------------ */
async function refreshDevices() {
  loadingDevices.value = true
  try {
    const res = await api.devices()
    env.value = res.adb
    devices.value = res.devices || []
    if (!res.ok && res.error) {
      ElMessage.warning(res.error)
    }
    const currentValid = devices.value.some((d) => d.serial === serial.value && d.ready)
    if (!currentValid) {
      const real = devices.value.find((d) => d.ready && d.serial !== 'demo')
      serial.value = (real || devices.value.find((d) => d.ready))?.serial || ''
    }
  } catch (err) {
    ElMessage.error(`读取设备列表失败：${err.message}`)
  } finally {
    loadingDevices.value = false
  }
}

async function doConnect() {
  const addr = connectAddr.value.trim()
  if (!addr) return
  connecting.value = true
  try {
    const r = await api.connect(addr)
    ElMessage[r.ok ? 'success' : 'error'](r.message || '连接已发送')
    if (r.ok) {
      connectAddr.value = ''
      await refreshDevices()
    }
  } catch (err) {
    ElMessage.error(err.message)
  } finally {
    connecting.value = false
  }
}

async function loadInfo() {
  if (!serial.value) return
  try {
    info.value = await api.info(serial.value)
  } catch (err) {
    info.value = null
  }
}

/* ------------------------------ 画面 ------------------------------ */
function freezeFrame() {
  // 图片模式没有实时可冻结，别把 frozen 置脏（否则切回设备时会误显示「已冻结」）
  if (frozen.value || imageMode.value) return
  frozen.value = true
  frozenReason.value = 'manual'
  stream.pause()
}

function resumeLive() {
  // 掉线状态下的「恢复实时」其实应该是重连，画面要等第一帧回来才解冻
  if (streamLost.value) {
    retryStream()
    return
  }
  frozen.value = false
  frozenReason.value = ''
  stream.resume()
  stream.refreshNow()
}

/** 状态栏上的「恢复实时 / 重连设备」按钮 */
function onFreezeAction() {
  if (frozenReason.value === 'lost') retryStream()
  else resumeLive()
}

/** 设备断开后点状态栏按钮 / 切回实时：重连设备，第一帧回来会自动解冻 */
function retryStream() {
  if (imageMode.value || !serial.value) return
  ElMessage.info('正在重新连接设备…')
  refreshDevices()
  stream.connect({ serial: serial.value, fps: fps.value, scale: scale.value })
}

/** 光标移动：同步坐标，并记住光标下的颜色（锚点取色模式下才有） */
function onHover(pt) {
  if (!pt) {
    hoverText.value = ''
    hoverColor.value = ''
    hoverCoord.value = null
    return
  }
  hoverText.value = `${pt.x}, ${pt.y}`
  hoverColor.value = pt.hex || ''
  hoverCoord.value = { x: pt.x, y: pt.y }
}

function clearAnchor() {
  anchor.value = null
  searchColor.value = ''
  findResult.value = null
}

/** 点「原画 1:1」时，若当前传输是缩放图，顺手切回原画，保证真的是 1 像素对 1 像素 */
function ensureOriginal() {
  if (scale.value !== 1) {
    scale.value = 1
    ElMessage.info('已切换到原画 1:1 传输，画面按设备像素显示')
  }
}

/* ------------------------------ 数据源：本地图片 ------------------------------ */
function openImagePicker() {
  fileInputRef.value?.click()
}

async function onFileChange(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (file) await loadImageFile(file)
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

function formatBytes(n) {
  if (!n && n !== 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

async function loadImageFile(file) {
  if (!file.type.startsWith('image/')) {
    ElMessage.error('请选择图片文件（png / jpg / webp 等）')
    return
  }
  if (file.size > 40 * 1024 * 1024) {
    ElMessage.error('图片过大，请小于 40MB')
    return
  }
  uploading.value = true
  try {
    const dataUrl = await fileToDataUrl(file)
    const up = await api.uploadImage({ name: file.name, dataUrl })
    // 从服务端取回归一化后的 PNG，保证显示像素与取色/找色所用像素完全一致
    const blob = await shotBlob({ serial: up.serial })
    const bmp = await createImageBitmap(blob)

    const prev = imageBitmap.value
    imageBitmap.value = bmp
    if (prev?.close) prev.close()

    imageSerial.value = up.serial
    imageInfo.value = { name: up.name, width: up.width, height: up.height, size: file.size }
    imageMode.value = true
    frozen.value = false
    frozenReason.value = ''
    streamError.value = ''
    stream.close()
    region.value = null
    clearAnchor()
    ElMessage.success(`已载入图片 ${up.width} × ${up.height}`)
  } catch (err) {
    ElMessage.error(`载入图片失败：${err.message}`)
  } finally {
    uploading.value = false
  }
}

function clearImage() {
  const prev = imageBitmap.value
  imageBitmap.value = null
  if (prev?.close) prev.close()
  imageSerial.value = ''
  imageInfo.value = null
  region.value = null
  clearAnchor()
}

async function saveWholeImage() {
  if (!imageInfo.value) return
  try {
    const blob = await shotBlob({ serial: imageSerial.value })
    const base = imageInfo.value.name.replace(/\.[^.]+$/, '')
    downloadBlob(blob, `${base}-export.png`)
    ElMessage.success('已保存整图（原始像素）')
  } catch (err) {
    ElMessage.error(`保存失败：${err.message}`)
  }
}

/* ------------------------------ Ctrl / ⌘ + S 保存 ------------------------------ */
const savingShot = ref(false)

function fileStamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/**
 * 有框选区域 → 存该区域；没有 → 存整屏。
 * 带上 frameId，保存的就是屏幕上正在看的那一帧（冻结时尤其重要）。
 * 图片模式下没有图片则直接忽略。
 */
async function saveCurrentShot() {
  if (savingShot.value) return
  if (imageMode.value && !imageInfo.value) return
  if (!activeSerial.value) return

  savingShot.value = true
  const area = region.value
  try {
    const payload = {
      serial: activeSerial.value,
      frameId: displayMeta.value?.frameId,
    }
    if (area) payload.region = area

    const blob = await shotBlob(payload)
    const stamp = fileStamp()
    const baseName = imageMode.value
      ? (imageInfo.value?.name || 'image').replace(/\.[^.]+$/, '')
      : serial.value || 'device'
    const filename = area
      ? `region-${area.x},${area.y}-${area.w}x${area.h}-${stamp}.png`
      : `screenshot-${baseName}-${stamp}.png`

    downloadBlob(blob, filename)
    ElMessage.success(area ? `已保存区域图 ${area.w} × ${area.h}` : '已保存整屏截图')
  } catch (err) {
    ElMessage.error(`保存失败：${err.message}`)
  } finally {
    savingShot.value = false
  }
}

const copyingShot = ref(false)

/** Ctrl / ⌘ + C：把手上的画面（区域优先，否则整屏）复制到剪贴板 */
async function copyCurrentShot() {
  if (copyingShot.value) return
  if (imageMode.value && !imageInfo.value) return
  if (!activeSerial.value) return

  copyingShot.value = true
  const area = region.value
  const payload = { serial: activeSerial.value, frameId: displayMeta.value?.frameId }
  if (area) payload.region = area

  const pending = shotBlob(payload)
  pending.catch(() => {}) // 避免剪贴板提前失败时产生未处理的 rejection

  try {
    await copyImageToClipboard(pending)
    ElMessage.success(area ? `已复制区域图 ${area.w} × ${area.h} 到剪贴板` : '已复制整屏截图到剪贴板')
  } catch (err) {
    // 剪贴板不可用（非 https / 浏览器限制）时退化为保存文件，别让操作白做
    try {
      const blob = await pending
      const stamp = fileStamp()
      const baseName = imageMode.value
        ? (imageInfo.value?.name || 'image').replace(/\.[^.]+$/, '')
        : serial.value || 'device'
      downloadBlob(
        blob,
        area
          ? `region-${area.x},${area.y}-${area.w}x${area.h}-${stamp}.png`
          : `screenshot-${baseName}-${stamp}.png`,
      )
      ElMessage.warning(`剪贴板不可用（${err.message}），已改为保存文件`)
    } catch (err2) {
      ElMessage.error(`复制失败：${err.message}`)
    }
  } finally {
    copyingShot.value = false
  }
}

function isTypingTarget(el) {
  const tag = el?.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el?.isContentEditable
}

/** 当前要复制/展示的颜色：优先光标下的像素，其次锚点（没拾取过锚点也能用） */
function pickableColor() {
  if (mode.value === 'color' && hoverColor.value) return hoverColor.value
  return searchColor.value || anchor.value?.hex || ''
}

/** C：复制当前颜色（悬停中的像素，或已拾取的锚点），格式跟设置一致 */
async function copyPickColor() {
  const color = pickableColor()
  if (!color) return
  const text = formatColor(color, colorFormat.value)
  if (!text) return
  const ok = await copyText(text)
  ok ? ElMessage.success(`已复制 ${text}`) : ElMessage.error('复制失败')
}

function cycleColorFormat() {
  setColorFormat(nextFormat(colorFormat.value))
  const sample = formatColor(pickableColor(), colorFormat.value) || formatExample(colorFormat.value)
  ElMessage.info(`颜色格式：${sample}`)
}

/**
 * C 复制的坐标来源：已框选时取框选的 x / y（整块选区），
 * 没框选时取光标下的坐标。
 */
function coordSourcePoint() {
  if (region.value) return region.value
  return hoverCoord.value
}

/** C（区域框选模式）：已框选复制整块选区 [x, y, w, h]，未框选复制光标位置 [x, y, 0, 0] */
async function copyCoord() {
  const pt = coordSourcePoint()
  if (!pt) {
    ElMessage.info('把鼠标移到画面上再按 C 复制坐标')
    return
  }
  const size = region.value ? { w: region.value.w, h: region.value.h } : null
  const text = formatCoord(pt, coordFormat.value, size, coordTemplate.value)
  if (!text) {
    if (coordFormat.value === 'custom') ElMessage.info('自定义模板为空，请到「设置 → 通用」里填写')
    return
  }
  const ok = await copyText(text)
  ok ? ElMessage.success(`已复制 ${text}`) : ElMessage.error('复制失败')
}

function cycleCoordFormat() {
  setCoordFormat(nextCoordFormat(coordFormat.value))
  const label = coordFormatLabel(coordFormat.value)
  if (coordFormat.value === 'custom' && !coordTemplate.value.trim()) {
    ElMessage.info('已切到自定义模板，请到「设置 → 通用」里填写')
    return
  }
  const size = region.value ? { w: region.value.w, h: region.value.h } : null
  const sample =
    formatCoord(coordSourcePoint(), coordFormat.value, size, coordTemplate.value) ||
    coordFormatExample(coordFormat.value, coordTemplate.value)
  const short = sample.length > 60 ? `${sample.slice(0, 60)}…` : sample
  ElMessage.info(sample ? `坐标格式（${label}）：${short}` : `坐标格式：${label}`)
}

/** Shift 单独按下再松开才切换格式，避免 Shift + 方向键微调时误触发 */
let shiftAlone = false

function onGlobalKeydown(e) {
  if (e.key === 'Shift') {
    shiftAlone = true
    return
  }
  if (shiftAlone) shiftAlone = false
  if (isTypingTarget(document.activeElement)) return

  const key = String(e.key || '').toLowerCase()
  const mod = e.ctrlKey || e.metaKey

  if (mod && !e.altKey && !e.shiftKey) {
    if (key === 's') {
      e.preventDefault()
      saveCurrentShot()
      return
    }
    if (key === 'c') {
      // 已选中文字时交还给浏览器默认的复制
      const hasSelection = (window.getSelection()?.toString() || '').length > 0
      if (hasSelection) return
      e.preventDefault()
      copyCurrentShot()
    }
    return
  }

  if (!mod && !e.altKey && !e.shiftKey && key === 'c') {
    // 选中了文字就先让浏览器正常复制，别抢
    if ((window.getSelection()?.toString() || '').length > 0) return
    // 两种模式都是「鼠标悬停即可复制」，不用先点出锚点 / 框出区域
    if (mode.value === 'color') {
      e.preventDefault()
      copyPickColor()
      return
    }
    if (mode.value === 'region') {
      e.preventDefault()
      copyCoord()
    }
  }
}

function onGlobalKeyup(e) {
  if (e.key !== 'Shift') return
  const alone = shiftAlone
  shiftAlone = false
  if (!alone || isTypingTarget(document.activeElement)) return
  if (mode.value === 'color') {
    cycleColorFormat()
    return
  }
  if (mode.value === 'region') cycleCoordFormat()
}

/**
 * 画面上直接 Ctrl / ⌘ + V：把剪贴板里的坐标文本变成框选区域。
 * 输入框内的粘贴交给输入框自己处理（那边解析成功会直接框选）。
 */
function onGlobalPaste(e) {
  if (mode.value !== 'region') return
  if (isTypingTarget(e.target)) return
  const text = e.clipboardData?.getData('text') || ''
  if (!text.trim()) return
  const res = parseRegion(text, {
    width: deviceW.value,
    height: deviceH.value,
    current: region.value,
  })
  // 解析不出来就当普通粘贴，不劫持
  if (!res.ok) return
  e.preventDefault()
  // 按坐标框选时冻结画面，避免实时刷新导致选区和看到的画面对不上
  freezeFrame()
  region.value = res.region
  ElMessage.success(`已按坐标框选 ${formatRegionText(res.region)}`)
}

function setSource(next) {
  if (next === 'image') {
    if (imageMode.value) return
    imageMode.value = true
    frozen.value = false
    frozenReason.value = ''
    streamError.value = ''
    stream.close()
    if (!imageInfo.value) openImagePicker()
    return
  }
  if (!imageMode.value) return
  imageMode.value = false
  if (serial.value) {
    stream.connect({ serial: serial.value, fps: fps.value, scale: scale.value })
  }
}

function onDragOver(e) {
  if (!e.dataTransfer?.types?.includes('Files')) return
  dragOver.value = true
}

function onDragLeave() {
  dragOver.value = false
}

async function onDrop(e) {
  dragOver.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file) await loadImageFile(file)
}

/* ------------------------------ 区域中心点偏移 ------------------------------ */
const MAX_OFFSETS = 20

function regionCenter(r) {
  return { x: Math.round(r.x + r.w / 2), y: Math.round(r.y + r.h / 2) }
}

/** 在画面上取一个点，换算成相对区域中心的偏移量 */
function onPickOffset(pt) {
  if (!region.value) return
  if (offsets.value.length >= MAX_OFFSETS) {
    ElMessage.warning(`最多添加 ${MAX_OFFSETS} 个偏移点`)
    return
  }
  const c = regionCenter(region.value)
  offsets.value = [
    ...offsets.value,
    {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      dx: pt.x - c.x,
      dy: pt.y - c.y,
    },
  ]
}

watch(region, (val) => {
  // 区域被清掉后，偏移点失去参照基点，一起清空
  if (!val) {
    offsets.value = []
    offsetPicking.value = false
  }
})

watch(mode, (val) => {
  if (val !== 'region') offsetPicking.value = false
})

/* ------------------------------ 取色与找色 ------------------------------ */
async function onPick(pt) {
  if (!activeSerial.value) return
  try {
    const px = await api.pixel(activeSerial.value, pt.x, pt.y, displayMeta.value?.frameId)
    lastError.value = ''
    anchor.value = { x: px.x, y: px.y, hex: px.hex, r: px.r, g: px.g, b: px.b, decimal: px.decimal }
    searchColor.value = px.hex
    runFind()
  } catch (err) {
    lastError.value = err.message
    ElMessage.error(`取色失败：${err.message}`)
  }
}

async function runFind() {
  if (!anchor.value || finding.value) return
  finding.value = true
  try {
    findResult.value = await api.findColor({
      serial: activeSerial.value,
      color: searchColor.value || anchor.value.hex,
      threshold: threshold.value,
      region: restrict.value && region.value ? region.value : null,
      limit: 800,
      frameId: displayMeta.value?.frameId,
    })
    lastError.value = ''
  } catch (err) {
    lastError.value = err.message
    ElMessage.error(`找色失败：${err.message}`)
  } finally {
    finding.value = false
  }
}

/* ------------------------------ 联动 ------------------------------ */
let findTimer = null
function scheduleFind(delay = 260) {
  clearTimeout(findTimer)
  findTimer = setTimeout(runFind, delay)
}

function onThreshold(v) {
  threshold.value = v
  scheduleFind()
}

function onRestrict(v) {
  restrict.value = v
  scheduleFind()
}

watch(
  region,
  () => {
    if (!restrict.value || !anchor.value) return
    scheduleFind(320)
  },
  { deep: true },
)

watch(serial, async (val) => {
  region.value = null
  findResult.value = null
  clearAnchor()
  frozen.value = false
  frozenReason.value = ''
  if (imageMode.value) return
  if (!val) return
  await loadInfo()
  stream.connect({ serial: val, fps: fps.value, scale: scale.value })
})

watch([fps, scale], () => {
  if (imageMode.value) return
  stream.configure({ fps: fps.value, scale: scale.value })
})

watch(streamError, (val) => {
  if (!val || imageMode.value) return
  // 掉线已有统一的冻结提示，不再重复弹错误
  if (streamLost.value) return
  ElMessage.error(val)
})

/**
 * 设备断开：自动冻结并保留最后一帧，此时框选 / 取色 / 保存区域图都照旧可用。
 * 设备恢复后第一帧到达，自动解除冻结继续实时投屏。
 */
watch(streamLost, (val) => {
  if (imageMode.value) return
  if (val) {
    if (frozen.value || !bitmap.value) return
    frozen.value = true
    frozenReason.value = 'lost'
    ElMessage.warning('设备连接已断开，已冻结并保留最后一帧')
    return
  }
  if (frozenReason.value === 'lost') {
    frozen.value = false
    frozenReason.value = ''
    ElMessage.success('设备已恢复连接，画面继续实时刷新')
  }
})

onMounted(async () => {
  try {
    env.value = await api.env()
  } catch {}
  try {
    landscapeMql = window.matchMedia('(orientation: landscape)')
    isLandscape.value = landscapeMql.matches
    landscapeMql.addEventListener('change', syncLandscape)
  } catch {}
  window.addEventListener('keydown', onGlobalKeydown)
  window.addEventListener('keyup', onGlobalKeyup)
  window.addEventListener('paste', onGlobalPaste)
  await refreshDevices()
  if (!serial.value) {
    // adb 不可用时退回演示模式，保证工具本身可预览
    const demo = devices.value.find((d) => d.serial === 'demo')
    if (demo) serial.value = 'demo'
  }
})

onBeforeUnmount(() => {
  landscapeMql?.removeEventListener('change', syncLandscape)
  window.removeEventListener('keydown', onGlobalKeydown)
  window.removeEventListener('keyup', onGlobalKeyup)
  window.removeEventListener('paste', onGlobalPaste)
  const bmp = imageBitmap.value
  if (bmp?.close) bmp.close()
})
</script>

<style scoped>
.opt-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.opt-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #cbd5e1;
  flex: 0 0 auto;
}

.opt-dot.device {
  background: #10b981;
}

.opt-dot.offline,
.opt-dot.unauthorized {
  background: #f59e0b;
}

.opt-dot.demo {
  background: #94a3b8;
}

.opt-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.opt-meta {
  font-size: 11px;
  color: #94a3b8;
}

.popover-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.popover-title {
  font-size: 12.5px;
  font-weight: 600;
  color: #1e293b;
}

.popover-actions {
  display: flex;
  gap: 6px;
}

.popover-actions .el-button {
  margin-left: 0;
}

.adb-tag {
  font-size: 11px;
}

.help-dot {
  color: #cbd5e1;
  cursor: help;
  font-size: 14px;
}

.help-dot:hover {
  color: #94a3b8;
}

.err-text {
  color: #dc2626;
  max-width: 46%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 状态栏里的冻结状态 + 操作按钮（放在这里不会遮挡画面） */
.status-main {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.status-action {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 19px;
  margin-left: 2px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid #f5d9a8;
  background: #fffbeb;
  color: #b45309;
  font-family: inherit;
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.status-action:hover {
  background: #fef3c7;
  border-color: #eabf6f;
}

.status-action.danger {
  border-color: #fecaca;
  background: #fef2f2;
  color: #b91c1c;
}

.status-action.danger:hover {
  background: #fee2e2;
  border-color: #fca5a5;
}

.status-action .el-icon {
  font-size: 11px;
}

/* 侧栏底部的设置入口 */
.settings-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  flex: 0 0 auto;
  border-radius: 9px;
  border: 1px solid var(--app-border);
  background: #fff;
  color: #475569;
  font-family: inherit;
  font-size: 12.5px;
  cursor: pointer;
  transition: all 0.15s;
}

.settings-btn:hover {
  color: #0b8480;
  border-color: #b7e6e3;
  background: #eef8f8;
}

.settings-btn .el-icon {
  font-size: 15px;
}

@media (orientation: landscape) {
  .settings-btn {
    width: 100%;
    margin-top: 2px;
  }

  .app-shell.rail-collapsed .settings-btn {
    width: 34px;
    padding: 0;
  }
}
</style>
