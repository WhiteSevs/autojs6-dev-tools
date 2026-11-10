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
          <el-tooltip content="实时抓取 ADB 设备屏幕" :placement="tipPlacement">
            <button :class="{ active: !imageMode }" @click="setSource('device')">
              <el-icon><Iphone /></el-icon><span class="btn-text">设备</span>
            </button>
          </el-tooltip>
          <el-tooltip content="用本地图片做坐标与取色（也可把图片拖到画面上）" :placement="tipPlacement">
            <button :class="{ active: imageMode }" @click="setSource('image')">
              <el-icon><Picture /></el-icon><span class="btn-text">图片</span>
            </button>
          </el-tooltip>
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
              <el-tooltip content="目标刷新率，实际帧率受设备截屏速度限制" :placement="tipPlacement">
                <el-select v-model="fps" class="fps-select" size="small">
                  <el-option v-for="v in [1, 2, 3, 5, 8]" :key="v" :label="`${v} fps`" :value="v" />
                </el-select>
              </el-tooltip>
            </div>

            <div class="hb-field">
              <label>画质</label>
              <el-tooltip content="原画 = 1:1 设备像素（最高精度，流量最大）" :placement="tipPlacement">
                <el-select v-model="scale" class="scale-select" size="small">
                  <el-option label="原画 1:1" :value="1" />
                  <el-option label="高清" :value="2" />
                  <el-option label="标准" :value="3" />
                  <el-option label="流畅" :value="4" />
                </el-select>
              </el-tooltip>
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
            :anchor="mode === 'color' ? anchor : null"
            :matches="mode === 'color' ? matches : []"
            :match-total="mode === 'color' ? findResult?.total || 0 : 0"
            :bbox="mode === 'color' ? bbox : null"
            :frozen="frozen && !imageMode"
            :empty-title="imageMode ? '还没有载入图片' : '等待画面…'"
            :empty-desc="
              imageMode ? '点「选择图片」，或把图片直接拖到这个区域' : '正在连接设备并拉取屏幕，稍候片刻'
            "
            @update:region="(v) => (region = v)"
            @pick="onPick"
            @interact="freezeFrame"
            @resume="resumeLive"
            @request-original="ensureOriginal"
            @hover="(v) => (hoverText = v ? `${v.x}, ${v.y}` : '')"
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
            :device-w="deviceW"
            :device-h="deviceH"
            :serial="activeSerial"
            :frame-id="displayMeta?.frameId"
            @update:region="(v) => (region = v)"
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
            @update:color="(v) => (searchColor = v)"
            @update:threshold="onThreshold"
            @update:restrict="onRestrict"
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
        <span>
          <span class="status-dot" :class="statusDotClass" />
          <b>{{ statusText }}</b>
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
        </span>
      </footer>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { ElMessage } from 'element-plus'
import ScreenStage from './components/ScreenStage.vue'
import RegionPanel from './components/RegionPanel.vue'
import ColorPanel from './components/ColorPanel.vue'
import DevicePanel from './components/DevicePanel.vue'
import { useStream } from './composables/useStream'
import { api, copyImageToClipboard, downloadBlob, shotBlob } from './api'

const stream = useStream()
const { bitmap, meta, ready, paused, error: streamError } = stream

const env = ref(null)
const devices = ref([])
const serial = ref('')
const info = ref(null)
const loadingDevices = ref(false)
const connecting = ref(false)
const connectAddr = ref('')

const mode = ref('region')
const panMode = ref(false)
const showToolbar = ref(true)
const railCollapsed = ref(readRailState())

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

function toggleRail() {
  railCollapsed.value = !railCollapsed.value
  try {
    localStorage.setItem('autojs6.railCollapsed', railCollapsed.value ? '1' : '0')
  } catch {}
}
const region = ref(null)
const anchor = ref(null)
const searchColor = ref('')
const threshold = ref(4)
const restrict = ref(false)
const findResult = ref(null)
const finding = ref(false)
const frozen = ref(false)
const hoverText = ref('')
const lastError = ref('')

const fps = ref(2)
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
  if (streamError.value) return streamError.value
  if (!adbOk.value) return '未检测到 adb'
  if (!serial.value) return '未选择设备'
  if (frozen.value) return '已冻结画面'
  if (!ready.value) return '正在连接画面…'
  return serial.value === 'demo' ? '演示模式' : '实时投屏中'
})

const statusDotClass = computed(() => {
  if (imageMode.value) return imageInfo.value ? 'on' : 'warn'
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
  if (frozen.value) return
  frozen.value = true
  stream.pause()
}

function resumeLive() {
  frozen.value = false
  stream.resume()
  stream.refreshNow()
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

function onGlobalKeydown(e) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return
  const key = String(e.key || '').toLowerCase()

  if (key === 's') {
    e.preventDefault()
    saveCurrentShot()
    return
  }

  if (key === 'c') {
    // 正在编辑文本或已选中文字时，交还给浏览器默认的复制
    const el = document.activeElement
    const tag = el?.tagName
    const editable = tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable
    const hasSelection = (window.getSelection()?.toString() || '').length > 0
    if (editable || hasSelection) return
    e.preventDefault()
    copyCurrentShot()
  }
}

function setSource(next) {  if (next === 'image') {
    if (imageMode.value) return
    imageMode.value = true
    frozen.value = false
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
  if (val && !imageMode.value) ElMessage.error(val)
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
</style>
