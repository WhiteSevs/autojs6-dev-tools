<template>
  <!-- 按需引入后，全局中文语言包改由 ConfigProvider 提供（它只渲染插槽，不影响布局） -->
  <el-config-provider :locale="zhCn">
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
              <el-button :loading="loadingDevices" circle @click="refreshDevices()">
                <el-icon v-if="!loadingDevices"><Refresh /></el-icon>
              </el-button>

              <!-- USB 直连：浏览器要先拿到这台设备的授权（WebUSB 规定必须由点击触发） -->
              <el-button
                v-if="usbMode"
                :loading="usbPicking"
                :title="usbOk ? '授权另一台 USB 设备' : '选择要连接的 USB 设备（首次需要授权）'"
                @click="pickUsbDevice"
              >
                <el-icon><Connection /></el-icon>
                <span class="btn-text">&nbsp;USB 设备</span>
              </el-button>

              <el-popover
                v-if="wirelessOk"
                v-model:visible="connectOpen"
                placement="bottom-start"
                :width="318"
                trigger="click"
                @after-enter="focusConnectInputOnEnter"
              >
                <template #reference>
                  <el-button>
                    <el-icon><Connection /></el-icon>
                    <span class="btn-text">&nbsp;无线连接</span>
                  </el-button>
                </template>
                <div class="popover-body">
                  <div class="popover-title">通过 Wi-Fi 连接 Android 设备</div>
                  <el-input
                    ref="connectInputRef"
                    v-model="connectAddr"
                    size="small"
                    placeholder="192.168.1.20:5555"
                    class="mono"
                    :disabled="connecting"
                    @keyup.enter="onConnectEnter"
                  />
                  <div class="popover-actions">
                    <el-button size="small" type="primary" :loading="connecting" @click="doConnect">连接</el-button>
                    <el-button size="small" :disabled="connecting" @click="connectAddr = ''">清空</el-button>
                  </div>

                  <!-- mDNS 自动发现：adb 支持 mdns 时列出同一局域网内开启「无线调试」的设备 -->
                  <div v-if="lanSupported" class="lan-block">
                    <div class="lan-head">
                      <span class="lan-title">
                        <el-icon><Location /></el-icon>
                        局域网设备
                        <em v-if="lanServices.length" class="lan-count">{{ lanServices.length }}</em>
                      </span>
                      <button
                        type="button"
                        class="lan-refresh"
                        :class="{ spinning: loadingLan }"
                        :disabled="loadingLan"
                        title="重新扫描局域网设备"
                        @click="loadLanDevices({ refresh: true })"
                      >
                        <el-icon><Refresh /></el-icon>
                      </button>
                    </div>
                    <ul v-if="lanServices.length" class="lan-list">
                      <li v-for="s in lanServices" :key="`${s.kind}-${s.deviceKey}`">
                        <button
                          type="button"
                          class="lan-item"
                          :class="[s.kind, { online: s.online || s.connected }]"
                          :disabled="connecting"
                          :title="
                            s.kind === 'pairing'
                              ? `输入配对码，与 ${s.address} 完成配对`
                              : `点击连接 ${s.address}`
                          "
                          @click="connectLanDevice(s)"
                        >
                          <span class="lan-dot" :class="{ on: s.online || s.connected }" />
                          <span class="lan-text">
                            <b>{{ s.model || s.deviceKey || s.name }}</b>
                            <em class="mono">{{ s.address }}</em>
                          </span>
                          <span class="lan-tag" :class="s.kind">
                            {{
                              s.kind === 'pairing'
                                ? '待配对'
                                : s.online || s.connected
                                  ? '已连接'
                                  : '可连接'
                            }}
                          </span>
                        </button>
                      </li>
                    </ul>
                    <div v-else class="lan-empty">
                      {{ loadingLan ? '正在扫描局域网…' : '未发现设备，请确认手机已开启「无线调试」且与本机同一 Wi-Fi' }}
                    </div>
                  </div>
                  <div v-else-if="lanSupported === false" class="lan-unsupported">
                    {{ lanReason === 'disabled' ? '当前 adb 未启用 mDNS 发现' : '当前 adb 不支持 mDNS 发现' }}<span
                      v-if="lanTip"
                      >（{{ lanTip }}）</span
                    >，可改用 <span class="mono">adb tcpip 5555</span> 方式。
                  </div>

                  <div v-if="connectHistory.length" class="history-block">
                    <div class="history-title">最近连接</div>
                    <ul class="history-list">
                      <li v-for="h in connectHistory" :key="h.addr" class="history-item">
                        <button
                          type="button"
                          class="history-main"
                          :title="`点击直接连接 ${h.addr}`"
                          @click="connectFromHistory(h)"
                        >
                          <span class="mono history-addr">{{ h.addr }}</span>
                          <span class="history-time">{{ formatConnectTime(h.at) }}</span>
                        </button>
                        <button
                          type="button"
                          class="history-del"
                          title="删除这条历史"
                          @click.stop="removeConnectHistory(h.addr)"
                        >
                          <el-icon><Close /></el-icon>
                        </button>
                      </li>
                    </ul>
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
                <label>来源</label>
                <div class="hb-seg">
                  <button
                    :class="{ active: !recordMode }"
                    title="逐帧截图（screencap）：像素无损，取色最准"
                    @click="setFrameSource('shot')"
                  >
                    <el-icon><Camera /></el-icon><span class="btn-text">截图</span>
                  </button>
                  <button
                    :class="{ active: recordMode }"
                    :disabled="isDemo"
                    :title="
                      isDemo
                        ? '演示模式没有真实设备，无法录屏'
                        : '屏幕录制（screenrecord）：画面更流畅，码率可调'
                    "
                    @click="setFrameSource('record')"
                  >
                    <el-icon><VideoCamera /></el-icon><span class="btn-text">录屏</span>
                  </button>
                </div>
              </div>

              <div class="hb-field">
                <label>实时</label>
                <el-switch
                  :model-value="!frozen"
                  inline-prompt
                  active-text="实时"
                  inactive-text="冻结"
                  style="--el-switch-on-color: #0ea5a0"
                  @change="(v) => (v ? resumeLive() : freezeFrame())"
                />
              </div>

              <div class="hb-field">
                <label>{{ recordMode ? '码率' : '帧率' }}</label>
                <!-- 两个下拉都常驻（v-show），避免 v-if 切换时复用同一个 el-select 实例导致显示值与绑定值错位 -->
                <el-select v-show="!recordMode" v-model="fps" :key="'fps'" class="fps-select" size="small">
                  <el-option v-for="v in FPS_OPTIONS" :key="v" :label="`${v} fps`" :value="v" />
                </el-select>
                <el-select v-show="recordMode" v-model="bitrate" :key="'bitrate'" class="bitrate-select" size="small">
                  <el-option v-for="b in BITRATE_OPTIONS" :key="b" :label="`${b / 1000000} Mbps`" :value="b" />
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
            <span class="tag-text mono">{{ adbOk ? `${engineShort || 'ADB'} 已就绪` : `${engineShort || 'ADB'} 未就绪` }}</span>
          </el-tag>
          <el-tooltip :content="engineTip" placement="bottom-end">
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
              :auto-resume="autoResume"
              :live-touch="liveTouch"
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
              @touch="onLiveTouch"
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
              :device-w="deviceW"
              :device-h="deviceH"
              @update:color="(v) => (searchColor = v)"
              @update:threshold="onThreshold"
              @update:restrict="onRestrict"
              @update:format="setColorFormat"
              @find="runFind"
              @clear="clearAnchorAndResume"
              @pick="onPick"
            />
            <DevicePanel
              v-if="!imageMode"
              :serial="serial"
              :info="info"
              :anchor="anchor"
              :record-mode="recordMode"
              :live-touch="liveTouch"
              @update:live-touch="setLiveTouch"
            />
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
            实际 <b class="mono">{{ displayMeta.fps || 0 }} fps</b>
            <template v-if="displayMeta.format === 'h264'">
              · 码率 <b class="mono">{{ Math.round((displayMeta.bitrate || 0) / 1000000) }} Mbps</b>
            </template>
            <template v-else>
              · 单帧 <b class="mono">{{ displayMeta.cost || 0 }}ms</b>
            </template>
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
        :auto-resume="autoResume"
        :env="env"
        :engine="env?.engine || 'adb'"
        :engines="env?.engines || []"
        @update:toolbar="setToolbarDefault"
        @update:color-format="setColorFormat"
        @update:coord-format="setCoordFormat"
        @update:coord-template="setCoordTemplate"
        @update:auto-resume="setAutoResume"
        @update:engine="switchEngine"
        />
    </div>
  </el-config-provider>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
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
/** 录屏码率档位（bps，降序排列）：截图模式不用它，切到录屏才显示。100 Mbps 为支持上限 */
const BITRATE_OPTIONS = [100, 20, 16, 12, 10, 8, 6, 4, 2].map((v) => v * 1000000)
/** 默认取最高档 */
const DEFAULT_BITRATE = BITRATE_OPTIONS[0]

const stream = useStream()
const {
  bitmap,
  meta,
  ready,
  paused,
  error: streamError,
  lost: streamLost,
  recordFatal,
} = stream

const env = ref(null)
const devices = ref([])
const serial = ref('')
const info = ref(null)
const loadingDevices = ref(false)
const connecting = ref(false)
const connectAddr = ref('')
/** 无线连接弹窗是否展开：连接成功后由代码收起 */
const connectOpen = ref(false)
/** 弹窗里的输入框实例，展开时用它自动聚焦 */
const connectInputRef = ref(null)

/* -------------------- mDNS 局域网设备发现（Android 11+ 无线调试） -------------------- */
/** 聚合后的局域网设备：[{ kind, name, deviceKey, host, address, addresses, connected, model }] */
const lanServices = ref([])
/** null = 尚未探测；false = 当前 adb 不支持 mdns（老版本 / 未编译 mdns），此时不展示列表 */
const lanSupported = ref(null)
const lanMessage = ref('')
/** unsupported = adb 没编 mdns；disabled = 编了但被关掉（部分 Windows 版本） */
const lanReason = ref('')
const loadingLan = ref(false)
const lanTip = computed(() => lanMessage.value || '需 platform-tools 30 及以上')

async function loadLanDevices({ refresh = false } = {}) {
  if (loadingLan.value) return
  loadingLan.value = true
  try {
    const res = await api.mdns(refresh)
    lanSupported.value = !!res.supported
    lanReason.value = res.reason || ''
    lanMessage.value = res.error || res.message || ''
    lanServices.value = res.services || []
  } catch (err) {
    // 扫描失败不弹窗打断操作：把区块收起来，用户仍可手输地址连接
    lanSupported.value = null
    lanMessage.value = err.message
    lanServices.value = []
  } finally {
    loadingLan.value = false
  }
}

/* -------------------- 无线连接历史（localStorage 持久化） -------------------- */
const CONNECT_HISTORY_KEY = 'autojs6.connectHistory.v1'
/** 只留最近几条，太多了弹窗里翻不过来 */
const CONNECT_HISTORY_MAX = 6

/**
 * 读取历史连接地址：[{ addr, at }]
 * 一律按 at 降序返回（最新的排最上面），顺手清掉脏数据 / 超量条目
 */
function readConnectHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(CONNECT_HISTORY_KEY) || '[]')
    if (!Array.isArray(raw)) return []
    return raw
      .filter((it) => it && typeof it.addr === 'string' && it.addr)
      .map((it) => ({ addr: it.addr, at: Number(it.at) || 0 }))
      .sort((a, b) => b.at - a.at)
      .slice(0, CONNECT_HISTORY_MAX)
  } catch {
    return []
  }
}

const connectHistory = ref(readConnectHistory())

function saveConnectHistory() {
  try {
    localStorage.setItem(CONNECT_HISTORY_KEY, JSON.stringify(connectHistory.value))
  } catch {}
}

/** 记录一条成功连接：同地址只留一条并顶到最前，因此列表天然是时间降序 */
function rememberConnect(addr) {
  const at = Date.now()
  connectHistory.value = [
    { addr, at },
    ...connectHistory.value.filter((h) => h.addr !== addr),
  ].slice(0, CONNECT_HISTORY_MAX)
  saveConnectHistory()
}

function removeConnectHistory(addr) {
  connectHistory.value = connectHistory.value.filter((h) => h.addr !== addr)
  saveConnectHistory()
}

/** 历史条目上的时间：今天只显示 HH:mm，跨天显示 MM-DD HH:mm */
function formatConnectTime(at) {
  if (!at) return ''
  const d = new Date(at)
  const pad = (n) => String(n).padStart(2, '0')
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return d.toDateString() === new Date().toDateString() ? hm : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`
}

const mode = ref('region')
const panMode = ref(false)
const showToolbar = ref(readToolbarDefault())
const railCollapsed = ref(readRailState())
const settingsOpen = ref(false)
const colorFormat = ref(readColorFormat())
const coordFormat = ref(readCoordFormat())
const coordTemplate = ref(readCoordTemplate())
/**
 * 自动恢复实时画面：取消框选（单击画面 / Esc / Delete / 右侧「清空」）后自动解除冻结。
 * 原本拆成「单击恢复实时」和「取消框选后恢复实时」两个开关，行为重叠、用户也分不清，
 * 已合并为这一个开关，默认开启。
 */
const autoResume = ref(readAutoResume())
/** 画面来源：shot = 逐帧截图（screencap），record = 屏幕录制（screenrecord） */
const frameSource = ref(readFrameSource())
/** 录屏码率（bps），截图模式不生效 */
const bitrate = ref(readBitrate())

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

const AUTO_RESUME_KEY = 'autojs6.autoResumeLive'

/**
 * 合并前是两个键：clickResumeLive（单击恢复，默认开）、resumeOnRegionClear（取消框选恢复，默认关）。
 * 新键还没写过时按旧值迁移：两个都关着才算关，否则保持默认开启。
 */
function readAutoResume() {
  try {
    const saved = localStorage.getItem(AUTO_RESUME_KEY)
    if (saved != null) return saved !== '0'
    const legacyClick = localStorage.getItem('autojs6.clickResumeLive')
    const legacyClear = localStorage.getItem('autojs6.resumeOnRegionClear')
    return !(legacyClick === '0' && legacyClear !== '1')
  } catch {
    return true
  }
}

function setAutoResume(v) {
  autoResume.value = !!v
  try {
    localStorage.setItem(AUTO_RESUME_KEY, v ? '1' : '0')
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

function readFrameSource() {
  try {
    return localStorage.getItem('autojs6.frameSource') === 'record' ? 'record' : 'shot'
  } catch {
    return 'shot'
  }
}

/** 码率档位改过一次，旧键直接弃用：老值不在新档位里时不至于悄悄沿用低码率 */
const BITRATE_KEY = 'autojs6.bitrate.v2'

function readBitrate() {
  try {
    const v = Number(localStorage.getItem(BITRATE_KEY))
    return BITRATE_OPTIONS.includes(v) ? v : DEFAULT_BITRATE
  } catch {
    return DEFAULT_BITRATE
  }
}

/**
 * 切换画面来源。
 * 截图 = 每帧调一次 screencap（像素无损、帧率低）；
 * 录屏 = screenrecord 出 H.264 流，流畅且省 USB 带宽，但是有损压缩。
 */
function setFrameSource(next) {
  if (next === 'record') {
    if (isDemo.value) {
      ElMessage.info('演示模式没有真实设备，录屏不可用')
      return
    }
    if (typeof window.VideoDecoder === 'undefined') {
      ElMessage.error('当前浏览器不支持 WebCodecs（H.264 解码），请使用 Chrome / Edge 94 及以上版本')
      return
    }
  }
  if (frameSource.value === next) return
  frameSource.value = next
  try {
    localStorage.setItem('autojs6.frameSource', next)
  } catch {}
  if (next === 'record') {
    ElMessage.success('已切到屏幕录制：画面更流畅；取色 / 保存仍按实时截图取精确像素')
  }
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
 * 开启「自动恢复实时画面」且当前处于冻结状态时，自动恢复实时画面。
 */
function clearRegion() {
  region.value = null
  if (autoResume.value && !imageMode.value && frozen.value) {
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
/** 当前连接引擎：adb（开发服务器）/ webusb（浏览器直连） */
const engine = computed(() => env.value?.engine || 'adb')
const usbMode = computed(() => engine.value === 'webusb')
const usbOk = computed(() => !!env.value?.engines?.find((e) => e.id === 'webusb')?.ok)
/** 当前引擎的能力集：无线调试 / mDNS 只有 adb 引擎有，入口要跟着隐藏 */
const currentCapabilities = computed(
  () => (env.value?.engines || []).find((e) => e.id === env.value?.engine)?.capabilities || {},
)
const wirelessOk = computed(() => !!currentCapabilities.value.wireless)
/** 当前连接引擎的短名（ADB / WebUSB），顶栏标签用它，避免切了引擎还写着 ADB */
const engineShort = computed(() => env.value?.engineShort || 'ADB')
const engineTip = computed(() => {
  const list = env.value?.engines || []
  const cur = list.find((e) => e.id === env.value?.engine)
  if (!cur) return '正在检测连接引擎'
  if (!cur.ok) return `${cur.label}不可用：${cur.error || '未知原因'}${cur.hint ? ` · ${cur.hint}` : ''}`
  return `${cur.label} · ${cur.detail || '已就绪'}`
})
const isDemo = computed(() => serial.value === 'demo')
/** 实际生效的录屏状态：演示模式没有真机，自动退回截图 */
const recordMode = computed(() => frameSource.value === 'record' && !isDemo.value)
/** 录屏模式服务端没有帧缓冲，取色 / 保存要现截一帧拿精确像素 */
const shotFresh = computed(() => recordMode.value && !imageMode.value)
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
  if (!adbOk.value) return `${engineShort.value} 未就绪`
  if (!serial.value) return '未选择设备'
  if (frozen.value) return '已冻结画面'
  if (!ready.value) return recordMode.value ? '正在启动屏幕录制…' : '正在连接画面…'
  return serial.value === 'demo' ? '演示模式' : recordMode.value ? '屏幕录制中' : '实时投屏中'
})

const statusDotClass = computed(() => {
  if (imageMode.value) return imageInfo.value ? 'on' : 'warn'
  if (frozenReason.value === 'lost') return 'err'
  if (streamError.value || !adbOk.value) return 'err'
  if (frozen.value) return 'warn'
  return ready.value ? 'on' : ''
})

/* ------------------------------ 设备 ------------------------------ */
/**
 * 拉取设备列表
 * @param {string} [preferSerial] 优先切换到的设备（无线连接成功后指向刚连上的那台）
 */
async function refreshDevices(preferSerial = '') {
  loadingDevices.value = true
  try {
    const res = await api.devices()
    if (res.adb) env.value = res.adb
    devices.value = res.devices || []
    if (!res.ok && res.error) {
      ElMessage.warning(res.error)
    }
    const ready = (d) => !!d && d.ready
    const pick = (s) => {
      // 只接受字符串：直接写 @click="refreshDevices" 会把 MouseEvent 传进来
      if (typeof s !== 'string' || !s) return null
      const exact = devices.value.find((d) => d.serial === s)
      if (ready(exact)) return exact
      // adb 偶尔把 serial 规范化成别的形式（端口不同 / 主机名解析），按主机段兜底匹配
      const host = s.includes(':') ? s.split(':')[0] : ''
      if (!host) return null
      return devices.value.find((d) => ready(d) && d.serial.split(':')[0] === host) || null
    }
    const preferred = pick(preferSerial)
    const currentValid = devices.value.some((d) => d.serial === serial.value && d.ready)
    if (preferred) {
      serial.value = preferred.serial
    } else if (!currentValid) {
      const real = devices.value.find((d) => d.ready && d.serial !== 'demo')
      serial.value = (real || devices.value.find((d) => d.ready))?.serial || ''
    }
  } catch (err) {
    ElMessage.error(`读取设备列表失败：${err.message}`)
  } finally {
    loadingDevices.value = false
  }
}

/* ---------------------- USB 直连：设备授权 ---------------------- */
const usbPicking = ref(false)

/**
 * 弹浏览器的 USB 选择框。
 * WebUSB 规定 requestDevice 必须由用户手势直接触发，所以这个动作只能挂在按钮点击上，
 * 不能在页面加载时自动调。授权过的设备之后会被 devices() 静默列出来。
 */
async function pickUsbDevice() {
  if (usbPicking.value) return
  usbPicking.value = true
  try {
    const r = await api.requestUsbDevice()
    if (!r.serial) return // 用户点了取消
    await refreshDevices(r.serial)
    const picked = devices.value.find((d) => d.serial === r.serial)
    ElMessage.success(picked?.ready === false ? '已授权，设备正在认证…' : '已授权 USB 设备')
  } catch (err) {
    ElMessage.error(`选择 USB 设备失败：${err.message}`)
  } finally {
    usbPicking.value = false
  }
}

/**
 * 切换连接引擎（设置 → 连接引擎）。
 * 换引擎等于换了一条通向设备的通道：旧设备信息、旧画面帧都不能继续用，所以切完立刻重建推流。
 * USB 直连这条路由页面自己实现，切过去时会顺带让开发服务器执行 adb kill-server（接口是独占的）。
 */
async function switchEngine(id) {
  if (!id || id === engine.value) return
  const before = serial.value
  try {
    const res = await api.setEngine(id)
    env.value = res.env
    // USB 接口独占：从 adb 切到 USB 直连时服务端会代劳 kill-server，得让用户知道一声
    const released = res.releasedAdb ? '（已自动释放 adb server）' : ''
    if (res.warning) ElMessage.warning(res.warning)
    else ElMessage.success(`已切换到「${res.env.engineLabel}」${released}，正在刷新设备`)
    await refreshDevices()

    // 演示模式不该挡在真机前面：换完引擎（尤其是切回 ADB）如果已经能拿到真机，直接切过去
    const real = devices.value.find((d) => d.ready && d.serial !== 'demo')
    if (real && (!serial.value || serial.value === 'demo')) {
      serial.value = real.serial
      return
    }
    // 刚切回 adb 时 server 还在重新枚举设备，稍后再刷一次，免得停在「未检测到设备」
    if (id === 'adb' && !real) setTimeout(() => refreshDevices(), 1200)

    // 设备没变（比如都停在演示模式）时 watch(serial) 不会触发，这里补一次，别让信息面板空着
    if (serial.value === before) {
      await loadInfo()
      stream.connect(streamOptions())
    }
  } catch (err) {
    ElMessage.error(`切换连接引擎失败：${err.message}`)
  }
}

/** 弹窗展开后把焦点交给输入框：内容可能还没挂载完，逐帧重试几次 */
function focusConnectInput(left = 20) {
  const el = connectInputRef.value
  if (!el) {
    if (left > 0) requestAnimationFrame(() => focusConnectInput(left - 1))
    return
  }
  el.focus?.()
  el.select?.()
}

/** 展开动画结束后的兜底：只在输入框还没拿到焦点时才动它，避免抢走用户刚敲的内容 */
function focusConnectInputOnEnter() {
  const el = connectInputRef.value
  if (el?.input && document.activeElement === el.input) return
  focusConnectInput()
}

/**
 * 规范化用户输入：兼容粘贴 `adb connect 1.2.3.4:5555`、全角冒号、多余空白，省略端口时补 5555
 */
function normalizeConnectAddr(raw) {
  let s = String(raw || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^adb\s+connect\s+/i, '')
    .replace(/^connect\s+/i, '')
    .replace(/：/g, ':')
    .trim()
  if (!s) return ''
  // 纯 IPv4 / 主机名没带端口 → 默认 5555（已带冒号的 IPv6 原样保留）
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(s) || /^[a-z0-9._-]+$/i.test(s)) s += ':5555'
  return s
}

/** 回车即连接：中文输入法联想中按回车不算 */
function onConnectEnter(e) {
  if (e?.isComposing || e?.keyCode === 229) return
  doConnect()
}

/** 点历史条目：填进输入框并直接连，不用再敲回车 */
function connectFromHistory(item) {
  if (connecting.value) return
  connectAddr.value = item.addr
  doConnect()
}

async function doConnect() {
  if (connecting.value) return
  const addr = normalizeConnectAddr(connectAddr.value)
  if (!addr) {
    ElMessage.warning('请输入设备地址，如 192.168.1.20:5555')
    focusConnectInput()
    return
  }
  connectAddr.value = addr
  connecting.value = true
  try {
    const r = await api.connect(addr)
    if (!r.ok) {
      ElMessage.error(r.message || '连接失败，请检查地址与网络')
      return
    }
    await finishConnect(addr, r.message)
  } catch (err) {
    ElMessage.error(err.message)
  } finally {
    connecting.value = false
    // 连接失败时弹窗还开着：把焦点还回输入框，方便改地址重试
    nextTick(() => {
      if (connectOpen.value) focusConnectInput()
    })
  }
}

/**
 * 连上之后的收尾：收起弹窗、记历史、刷新设备列表并切到刚连上的那台。
 * mDNS 发现（可能同时有多个旧端口）与手输地址都走这里。
 */
async function finishConnect(addr, fallbackMessage = '') {
  connectOpen.value = false
  connectAddr.value = ''
  rememberConnect(addr)
  const prev = serial.value
  await refreshDevices(addr)
  const picked = devices.value.find((d) => d.serial === serial.value)
  if (picked && picked.serial === prev && !imageMode.value && (streamLost.value || !ready.value)) {
    // 选中的本来就是这台：watch 不会触发，画面没就绪就手动重建一次
    frozen.value = false
    frozenReason.value = ''
    stream.connect(streamOptions())
  }
  ElMessage.success(picked && picked.ready ? `已连接并切换到 ${picked.model || picked.serial}` : fallbackMessage || '连接成功')
}

/** 依次尝试一组候选地址（同一设备在 mDNS 里常留有多条旧端口记录，前几条可能已失效） */
async function connectAnyAddress(addresses) {
  let last = ''
  for (const addr of addresses) {
    try {
      const r = await api.connect(addr)
      if (r.ok) return { ok: true, addr, message: r.message }
      last = r.message || last
    } catch (err) {
      last = err.message
    }
  }
  return { ok: false, message: last }
}

/** 点局域网设备：已在线直接切过去；connect 服务发起连接；pairing 服务先要配对码 */
async function connectLanDevice(item) {
  if (connecting.value) return
  if (item.kind === 'pairing') return pairLanDevice(item)
  if (item.online && item.serial) {
    serial.value = item.serial
    connectOpen.value = false
    ElMessage.success(`已切换到 ${item.model || item.serial}`)
    return
  }
  connecting.value = true
  try {
    const r = await connectAnyAddress(item.addresses || [item.address])
    if (!r.ok) {
      ElMessage.error(r.message || '连接失败，请确认该设备已与电脑配对过')
      return
    }
    await finishConnect(r.addr)
  } finally {
    connecting.value = false
  }
}

/** 配对流程：配对码在手机的「使用配对码配对设备」弹窗里；配对成功后端口会变，重扫一次再连 */
async function pairLanDevice(item) {
  let code = ''
  try {
    const res = await ElMessageBox.prompt(
      `请输入手机「使用配对码配对设备」里显示的 6 位配对码（${item.address}）`,
      '无线调试配对',
      {
        confirmButtonText: '配对',
        cancelButtonText: '取消',
        inputPlaceholder: '6 位数字',
        inputPattern: /^\d{6}$/,
        inputErrorMessage: '配对码应为 6 位数字',
        closeOnClickModal: false,
      },
    )
    code = String(res.value || '').trim()
  } catch {
    return
  }
  connecting.value = true
  try {
    const r = await api.pair(item.address, code)
    if (!r.ok) {
      ElMessage.error(r.message || '配对失败，配对码可能已过期')
      return
    }
    const res = await api.mdns(true)
    lanSupported.value = !!res.supported
    lanServices.value = res.services || []
    const target =
      lanServices.value.find(
        (s) => s.kind === 'connect' && (s.deviceKey === item.deviceKey || s.host === item.host),
      ) || lanServices.value.find((s) => s.kind === 'connect' && s.host === item.host)
    if (!target) {
      ElMessage.success('配对成功，稍等片刻再点一次列表里的设备即可连接')
      return
    }
    const c = await connectAnyAddress(target.addresses || [target.address])
    if (c.ok) await finishConnect(c.addr, '配对成功并已连接')
    else ElMessage.warning(`配对成功，但自动连接失败：${c.message}`)
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

/**
 * 模式切换时的画面状态：区域框选要看实时画面，锚点取色要有稳定画面才能取准。
 * 只在「自动恢复实时画面」开启、且不是设备掉线冻结时介入；图片模式没有实时流，不处理。
 */
function syncFreezeOnModeChange(next, prev) {
  if (!autoResume.value || imageMode.value) return
  if (frozenReason.value === 'lost') return
  if (next === 'region' && prev === 'color') {
    // 带着锚点从取色切回框选：之前的冻结是取色的产物，先恢复实时
    if (frozen.value && anchor.value) resumeLive()
    return
  }
  if (next === 'color' && prev === 'region') {
    // 带着锚点切回取色：冻住画面，保证「看到的像素」就是「取到的像素」
    if (anchor.value && !frozen.value) freezeFrame()
  }
}

/** 建立 / 重建投屏连接所需的全部参数（画面来源与码率也在里面） */
function streamOptions() {
  return {
    serial: serial.value,
    fps: fps.value,
    scale: scale.value,
    mode: recordMode.value ? 'record' : 'shot',
    bitrate: bitrate.value,
  }
}

/** 设备断开后点状态栏按钮 / 切回实时：重连设备，第一帧回来会自动解冻 */
function retryStream() {
  if (imageMode.value || !serial.value) return
  ElMessage.info('正在重新连接设备…')
  refreshDevices()
  stream.connect(streamOptions())
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

/**
 * 用户主动清除锚点（「清除锚点」按钮 / 输入框的 × / 留空回车）：
 * 开启「自动恢复实时画面」时解除冻结 —— 但只在**没有区域框选**时这么做。
 * 还留着区域说明还在按这块区域干活（比如「仅在区域内找色」），画面得继续冻着，
 * 否则区域和实时画面会对不上。切设备 / 载入图片走的是 clearAnchor()，不在这里恢复。
 */
function clearAnchorAndResume() {
  clearAnchor()
  if (autoResume.value && !imageMode.value && frozen.value && !region.value) {
    resumeLive()
  }
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
    if (shotFresh.value) payload.fresh = true

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
  if (shotFresh.value) payload.fresh = true

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

/**
 * 实时点击期间的按键映射：画面就是一台真机，键盘直接对它生效。
 *
 * 只收「没有别处用途」的键 —— C / L / R / 1 / 2 / P / F / T 这些画面上都有活要干，
 * 一个都不碰。方向键留给画布（放大后还要靠它们微调），空格平时是按住平移，
 * 只在实时点击期间让位给真机的空格。
 *
 * 音量按 F1 / F2 / F3 直接触发，不用按 Fn：笔记本的 F 排在「多媒体键」模式下本来就会
 * 把 F1~F3 翻译成静音 / 音量- / 音量+，这时浏览器收到的是 AudioVolumeXxx；
 * 在「功能键」模式下收到的就是 F1~F3。两类事件都认，所以按 F1 还是 Fn+F1 都能生效。
 * （Fn 本身浏览器永远收不到，它在硬件层就被吃掉了，所以没法也不需要监听它。）
 */
const LIVE_KEYS = {
  escape: { key: 'back', label: '返回', repeat: false },
  backspace: { key: 'delete', label: '退格', repeat: true },
  delete: { key: 'forward_del', label: '删除', repeat: true },
  space: { key: 'space', label: '空格', repeat: true },
  f1: { key: 'volume_mute', label: '静音', repeat: false },
  audiovolumemute: { key: 'volume_mute', label: '静音', repeat: false },
  f2: { key: 'volume_down', label: '音量-', repeat: true },
  audiovolumedown: { key: 'volume_down', label: '音量-', repeat: true },
  f3: { key: 'volume_up', label: '音量+', repeat: true },
  audiovolumeup: { key: 'volume_up', label: '音量+', repeat: true },
}

/** 连发的最小间隔：系统一条 key repeat 是 30ms 级，全转发会把设备刷爆、越按越滞后 */
const LIVE_KEY_REPEAT_MS = 110
let lastLiveKeyAt = 0

/**
 * 实时点击期间把某个键转发给真机。
 * 成功不弹提示（会连按），只在失败时说一声。
 */
async function sendDeviceKey({ key, label }) {
  if (!serial.value || isDemo.value) return
  try {
    await api.key(serial.value, key)
  } catch (err) {
    ElMessage.error(`${label}键发送失败：${err.message}`)
  }
}

function onGlobalKeydown(e) {
  if (e.key === 'Shift') {
    shiftAlone = true
    return
  }
  if (shiftAlone) shiftAlone = false
  if (isTypingTarget(document.activeElement)) return

  const key = String(e.key || '').toLowerCase()
  const mod = e.ctrlKey || e.metaKey

  // 实时点击期间：键盘直接打在真机上（Esc 返回、⌫ 退格、Del 删除、空格、F1~F3 音量）。
  // 这里必须 !mod && !alt —— Ctrl+S / Ctrl+C 与 Alt 平移都还要正常用；Shift 不拦，
  // Shift+删除就是「删」，交给真机自己判断。
  if (liveTouch.value && !mod && !e.altKey) {
    // e.key 会随输入法 / 键盘布局变（中文输入法激活时可能给 'Process'），
    // 再拿 e.code 兜一层：F1~F3 与 Space 的 code 跟布局无关，永远认得出
    const code = String(e.code || '').toLowerCase()
    const mapped = LIVE_KEYS[key] || LIVE_KEYS[code] || null
    if (mapped?.key) {
      e.preventDefault()
      const now = Date.now()
      // 单发键挡掉 key repeat（否则按住 Esc 会退到桌面）；连发键按间隔节流，设备才跟得上
      if (!e.repeat || (mapped.repeat && now - lastLiveKeyAt >= LIVE_KEY_REPEAT_MS)) {
        lastLiveKeyAt = now
        sendDeviceKey(mapped)
      }
      return
    }
  }

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

  // L：开关远程触控的「实时点击」，不用把手从画面上挪开
  if (!mod && !e.altKey && !e.shiftKey && key === 'l') {
    e.preventDefault()
    toggleLiveTouchByKey()
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
    stream.connect(streamOptions())
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

watch(mode, (val, old) => {
  if (val !== 'region') offsetPicking.value = false
  syncFreezeOnModeChange(val, old)
})

/* ------------------------------ 取色与找色 ------------------------------ */
/** 远程触控开关：只有录屏画面下才允许开启（画面实时，点哪就操作哪） */
const liveTouch = ref(false)

/** 切换远程触控；录屏模式下画面是实时的，点哪就操作哪 */
function setLiveTouch(on) {
  if (!on) {
    liveTouch.value = false
    return
  }
  if (!recordMode.value) {
    ElMessage.info('切到「录屏」画面后才能直接操作真机')
    return
  }
  liveTouch.value = true
  // 触控是「看着实时画面点真机」，和框选互斥：还留着选区的话，点画面到底是操作真机
  // 还是继续折腾选区会有歧义，所以进触控前先把框选收掉（clearRegion 会按设置恢复实时）
  if (region.value) clearRegion()
  // 触控要看着实时画面点，顺手把冻结解掉
  if (frozen.value) resumeLive()
}

/** L：开关「实时点击」，和右侧「设备与操作 → 远程触控」那个按钮等价 */
function toggleLiveTouchByKey() {
  setLiveTouch(!liveTouch.value)
}

/**
 * 画面上的触摸事件 → 真机。
 * down 立刻发、拖动过程中按 40ms 的节奏发最新位置、抬手发 up，
 * 所以按住拖拽是真机在跟着鼠标走，而不是松开后才「补」一个手势。
 */
function onLiveTouch({ phase, x, y }) {
  if (!serial.value || imageMode.value) return
  stream.sendTouch({ phase, x, y })
}

async function onPick(pt) {
  if (!activeSerial.value) return
  try {
    const px = await api.pixel(activeSerial.value, pt.x, pt.y, displayMeta.value?.frameId, shotFresh.value)
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
      // 找色不强制重新截屏：取色时刚截过一帧，服务端 2.5s 内会复用，
      // 这样「取哪个像素」和「在哪找色」用的是同一帧，结果更一致
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

/* 无线连接弹窗展开 → 输入框自动聚焦，直接敲地址回车即可；同时扫一次 mDNS 局域网设备并定时刷新 */
let lanTimer = null
function stopLanPoll() {
  if (lanTimer) {
    clearInterval(lanTimer)
    lanTimer = null
  }
}

watch(connectOpen, (open) => {
  if (!open) {
    stopLanPoll()
    return
  }
  nextTick(() => requestAnimationFrame(() => focusConnectInput()))
  loadLanDevices()
  stopLanPoll()
  // 手机开启 / 关闭无线调试后端口会变，弹窗开着就每 10s 重扫，连上后弹窗收起即停
  lanTimer = setInterval(() => {
    if (!connecting.value) loadLanDevices({ refresh: true })
  }, 10000)
})

watch(serial, async (val) => {
  region.value = null
  findResult.value = null
  clearAnchor()
  frozen.value = false
  frozenReason.value = ''
  if (imageMode.value) return
  if (!val) return
  await loadInfo()
  stream.connect(streamOptions())
})

watch([fps, scale], () => {
  if (imageMode.value) return
  stream.configure({ fps: fps.value, scale: scale.value })
})

/* 切画面来源 / 调码率：来源变更重建连接（服务端整条管道要换），码率只发 config 让服务端重开录屏 */
watch([frameSource, bitrate], () => {
  try {
    localStorage.setItem(BITRATE_KEY, String(bitrate.value))
  } catch {}
  if (imageMode.value) return
  stream.configure({ mode: recordMode.value ? 'record' : 'shot', bitrate: bitrate.value })
})

/* 离开录屏画面（切回截图 / 切到图片）就退出远程触控，避免后续点击误发到真机 */
watch(recordMode, (val) => {
  if (!val) liveTouch.value = false
})

/* 录屏彻底不可用（设备不支持 / 编码器被占用 / 解码失败）：提示后自动退回截图 */
watch(recordFatal, (val) => {
  if (!val) return
  recordFatal.value = ''
  // 这一条的提示由下面这行统一给出，别让 streamError 再弹一个重复的 toast
  streamError.value = ''
  ElMessage.error(`录屏不可用：${val}，已切回截图模式`)
  frameSource.value = 'shot'
  try {
    localStorage.setItem('autojs6.frameSource', 'shot')
  } catch {}
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

/** USB 热插拔：插上 / 拔掉立刻刷新设备列表，不用手动点刷新 */
let usbHotplugAt = 0
function onUsbHotplug() {
  // Chrome 插拔时会连发几条事件（interface 级 + device 级），节流一下
  const now = Date.now()
  if (now - usbHotplugAt < 600) return
  usbHotplugAt = now
  refreshDevices()
}

onMounted(async () => {
  // 先确认有没有开发服务器、该用哪条连接引擎；没有后端就直接走浏览器 USB 直连
  try {
    await api.boot()
  } catch {}
  try {
    env.value = await api.env()
  } catch {}
  try {
    landscapeMql = window.matchMedia('(orientation: landscape)')
    isLandscape.value = landscapeMql.matches
    landscapeMql.addEventListener('change', syncLandscape)
  } catch {}
  try {
    navigator.usb?.addEventListener('connect', onUsbHotplug)
    navigator.usb?.addEventListener('disconnect', onUsbHotplug)
  } catch {}
  window.addEventListener('keydown', onGlobalKeydown)
  window.addEventListener('keyup', onGlobalKeyup)
  window.addEventListener('paste', onGlobalPaste)
  await refreshDevices()
  if (!serial.value) {
    // 没有可用设备时退回演示模式，保证工具本身可预览
    const demo = devices.value.find((d) => d.serial === 'demo')
    if (demo) serial.value = 'demo'
  }
})

onBeforeUnmount(() => {
  stopLanPoll()
  landscapeMql?.removeEventListener('change', syncLandscape)
  try {
    navigator.usb?.removeEventListener('connect', onUsbHotplug)
    navigator.usb?.removeEventListener('disconnect', onUsbHotplug)
  } catch {}
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

/* mDNS 自动发现的局域网设备：点一下即连（待配对的会先要配对码） */
.lan-block {
  border: 1px dashed #dbe3ec;
  border-radius: 8px;
  padding: 6px 7px;
  background: #fbfdff;
}

.lan-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-bottom: 4px;
}

.lan-title {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  color: #64748b;
}

.lan-count {
  font-style: normal;
  font-size: 10px;
  color: #0b8480;
  background: #e7f6f5;
  border-radius: 8px;
  padding: 0 5px;
  line-height: 15px;
}

.lan-refresh {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 19px;
  height: 19px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #9aa8bb;
  font-size: 11px;
  cursor: pointer;
}

.lan-refresh:hover {
  color: #0ea5a0;
  background: #eef8f8;
}

.lan-refresh.spinning {
  color: #0ea5a0;
  animation: lan-spin 0.9s linear infinite;
}

@keyframes lan-spin {
  to {
    transform: rotate(360deg);
  }
}

.lan-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 132px;
  overflow-y: auto;
}

.lan-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  text-align: left;
  font: inherit;
  color: inherit;
}

.lan-item:hover:not(:disabled) {
  background: #eef8f8;
}

.lan-item:disabled {
  cursor: progress;
  opacity: 0.6;
}

.lan-dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #cbd5e1;
}

.lan-dot.on {
  background: #12a594;
  box-shadow: 0 0 0 2px #d6f2ef;
}

.lan-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.lan-text b {
  font-size: 11.5px;
  font-weight: 600;
  color: #1e293b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lan-text em {
  font-style: normal;
  font-size: 10.5px;
  color: #94a3b8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lan-tag {
  flex: none;
  font-size: 10px;
  line-height: 16px;
  padding: 0 5px;
  border-radius: 8px;
  color: #64748b;
  background: #f1f5f9;
}

.lan-tag.connect {
  color: #1f6feb;
  background: #eaf1fd;
}

.lan-tag.pairing {
  color: #b45309;
  background: #fdf1e0;
}

.lan-item.online .lan-tag.connect {
  color: #0b8480;
  background: #e7f6f5;
}

.lan-empty,
.lan-unsupported {
  font-size: 10.5px;
  line-height: 1.55;
  color: #94a3b8;
  padding: 2px 2px 1px;
}

.lan-unsupported .mono {
  color: #64748b;
}

/* 最近连接：按时间降序，点一下直接连，右侧叉号删掉这条 */
.history-block {
  border-top: 1px dashed #e2e8f0;
  padding-top: 8px;
  margin-top: 2px;
}

.history-title {
  font-size: 11px;
  color: #94a3b8;
  margin-bottom: 4px;
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 132px;
  overflow-y: auto;
}

.history-item {
  display: flex;
  align-items: center;
  gap: 2px;
  border-radius: 6px;
}

.history-item:hover {
  background: #f1f5f9;
}

.history-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 4px 6px;
  border: 0;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  font: inherit;
  color: inherit;
}

.history-addr {
  flex: 1;
  min-width: 0;
  font-size: 11.5px;
  color: #334155;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-time {
  flex: none;
  font-size: 10.5px;
  color: #a8b3c4;
}

.history-del {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  margin-right: 2px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #cbd5e1;
  font-size: 11px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s, color 0.12s, background 0.12s;
}

.history-item:hover .history-del,
.history-del:focus-visible {
  opacity: 1;
}

/* 触摸屏没有 hover，删除按钮一直显示，否则看不见 */
@media (hover: none) {
  .history-del {
    opacity: 1;
  }
}

.history-del:hover {
  color: #dc2626;
  background: #fee2e2;
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
