import { onBeforeUnmount, ref, shallowRef } from 'vue'
import { createAnnexBParser } from '../utils/h264'

/**
 * 实时投屏：与 /ws/screen 建立 WebSocket，接收二进制帧。
 *
 * 两种画面来源，线上协议不同：
 *  - 截图（screencap）：[4字节 metaLength][metaJSON][PNG]，PNG 无损，预览像素 = 取色像素
 *  - 录屏（screenrecord）：metaLength 恒为 0，后面是 H.264 裸流，交给 WebCodecs 解码成画面
 *
 * 对外暴露的 bitmap / meta 对两种来源保持一致（都是 ImageBitmap + 统一 meta），
 * 上层组件不需要关心画面到底怎么来的。
 */
export function useStream() {
  const bitmap = shallowRef(null)
  const meta = ref(null)
  const ready = ref(false)
  const paused = ref(false)
  const error = ref('')
  const frameCount = ref(0)
  /** 实时流中断（设备掉线 / 服务重启）：画面保留最后一帧，由上层决定是否冻结 */
  const lost = ref(false)
  /** 录屏彻底失败（设备不支持 / 被占用），上层据此回退到截图模式 */
  const recordFatal = ref('')

  let ws = null
  let options = { serial: null, fps: 8, scale: 3, mode: 'shot', bitrate: 8_000_000 }
  let manualClose = false
  let reconnectTimer = null
  let decoding = false

  /* ------------------------------ 录屏解码状态 ------------------------------ */
  /**
   * 兜底 codec 列表：正常情况下会先从 SPS 里读出 profile 再拼字符串，
   * 这里只在「收到的第一帧不含 SPS」时按常见顺序逐个试。
   * level 统一取较低的档位，Chrome 只拿它做能力校验，真正解码以流内 SPS 为准。
   */
  const CODEC_CANDIDATES = ['avc1.640028', 'avc1.4D401E', 'avc1.42E01E']
  /** profile_idc → 稳定可用的 codec 字符串（避免 level_idc 报得离谱时被浏览器拒绝） */
  const PROFILE_CODECS = {
    66: 'avc1.42E01E', // Baseline
    77: 'avc1.4D401E', // Main
    88: 'avc1.58A01E', // Extended
    100: 'avc1.640028', // High
    110: 'avc1.6E0028', // High 10
    122: 'avc1.7A0028', // High 4:2:2
    244: 'avc1.F40028', // High 4:4:4
  }
  /** screenrecord 默认 60fps；时间戳只用于给解码器排序，不影响播放节奏 */
  const FRAME_TS_US = 16667
  /** meta（fps / 码率 / 尺寸）的刷新间隔：状态栏不需要 60Hz，少换对象就少重渲染 */
  const META_MIN_GAP = 250

  let decoder = null
  let parser = null
  let tsUs = 0
  let converting = false
  let metaPushedAt = 0
  let videoInfo = null
  let videoFps = 0
  let fpsCount = 0
  let fpsWindowAt = 0
  let restartTimes = []
  /** 上一段流用过的 codec：解码器中途重建时复用，省一次探测 */
  let lastCodec = ''

  function buildUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const q = new URLSearchParams({
      serial: options.serial || 'demo',
      fps: String(options.fps),
      scale: String(options.scale),
      level: String(options.level ?? 3),
      mode: options.mode === 'record' ? 'record' : 'screencap',
      bitrate: String(options.bitrate ?? 8_000_000),
    })
    return `${proto}//${location.host}/ws/screen?${q.toString()}`
  }

  /* ------------------------------ 截图帧（PNG） ------------------------------ */
  async function handleImageFrame(buffer) {
    if (decoding) return
    decoding = true
    try {
      const view = new DataView(buffer)
      const metaLen = view.getUint32(0)
      const metaText = new TextDecoder().decode(new Uint8Array(buffer, 4, metaLen))
      const frameMeta = JSON.parse(metaText)
      const bytes = new Uint8Array(buffer, 4 + metaLen)
      const type = frameMeta.format === 'jpeg' ? 'image/jpeg' : 'image/png'
      const blob = new Blob([bytes], { type })
      const bmp = await createImageBitmap(blob)
      const prev = bitmap.value
      bitmap.value = bmp
      meta.value = frameMeta
      ready.value = true
      error.value = ''
      lost.value = false
      frameCount.value += 1
      if (prev && prev.close) {
        try { prev.close() } catch {}
      }
    } catch (err) {
      error.value = `帧解析失败：${err.message}`
    } finally {
      decoding = false
    }
  }

  /* ------------------------------ 录屏帧（H.264） ------------------------------ */
  function resetVideoPipeline() {
    try { decoder?.close() } catch {}
    decoder = null
    parser?.reset()
    parser = null
    tsUs = 0
  }

  function onDecoderError(err) {
    const now = Date.now()
    restartTimes = restartTimes.filter((t) => now - t < 10_000)
    try { decoder?.close() } catch {}
    decoder = null
    parser?.reset()
    // 解码器挂了只能让服务端重开一段录屏（从关键帧重新开始）
    if (restartTimes.length < 3) {
      restartTimes.push(now)
      send({ type: 'record-restart' })
    } else {
      recordFatal.value = `录屏解码失败：${err?.message || '解码器异常'}`
    }
  }

  /** 从 Annex-B 数据里找 SPS（NAL type 7），按 profile_idc 换成 codec 字符串 */
  function detectCodec(data) {
    for (let i = 0; i + 4 < data.length; i++) {
      if (data[i] !== 0 || data[i + 1] !== 0 || data[i + 2] !== 1) continue
      const p = i + 3
      if ((data[p] & 0x1f) === 7 && p + 1 < data.length) {
        return PROFILE_CODECS[data[p + 1]] || 'avc1.640028'
      }
      i = p
    }
    return ''
  }

  function ensureDecoder(hint) {
    if (decoder && decoder.state !== 'closed') return decoder
    if (typeof VideoDecoder === 'undefined') {
      error.value = '当前浏览器不支持 WebCodecs，录屏模式需要 Chrome / Edge 94+'
      return null
    }
    const candidates = []
    for (const codec of [hint, lastCodec, ...CODEC_CANDIDATES]) {
      if (codec && !candidates.includes(codec)) candidates.push(codec)
    }
    let lastErr = null
    for (const codec of candidates) {
      let d
      try {
        d = new VideoDecoder({ output: onVideoFrame, error: onDecoderError })
        d.configure({ codec, optimizeForLatency: true })
      } catch (err) {
        lastErr = err
        try { d?.close() } catch {}
        continue
      }
      decoder = d
      lastCodec = codec
      tsUs = 0
      return d
    }
    error.value = `H.264 解码器初始化失败：${lastErr?.message || '不支持的编码格式'}`
    return null
  }

  function buildVideoMeta(width, height) {
    const dw = videoInfo?.deviceWidth || width
    const dh = videoInfo?.deviceHeight || height
    return {
      serial: options.serial,
      width,
      height,
      deviceWidth: dw,
      deviceHeight: dh,
      // 放大镜靠它把设备坐标换算成画面像素，非整数倍也能用
      scale: width ? dw / width : 1,
      format: 'h264',
      mode: 'record',
      bitrate: videoInfo?.bitrate || options.bitrate,
      fps: Number(videoFps.toFixed(1)),
      ts: Date.now(),
      cost: 0,
    }
  }

  function onVideoFrame(frame) {
    const now = performance.now()
    // 一秒一个窗口统计解码帧率：按到达间隔算瞬时值会被解码器的突发输出带飞
    fpsCount += 1
    if (!fpsWindowAt) fpsWindowAt = now
    if (now - fpsWindowAt >= 1000) {
      videoFps = Math.round((fpsCount * 1000) / (now - fpsWindowAt))
      fpsCount = 0
      fpsWindowAt = now
    }

    // 冻结时不刷新画面；上一帧的 ImageBitmap 还没转换完时先丢掉本帧（宁可少一帧也不排队）
    if (paused.value || converting) {
      try { frame.close() } catch {}
      return
    }
    converting = true

    const w = frame.displayWidth || frame.codedWidth
    const h = frame.displayHeight || frame.codedHeight
    createImageBitmap(frame)
      .then((bmp) => {
        const prev = bitmap.value
        bitmap.value = bmp
        // meta 只用来显示 fps / 码率 和尺寸，没必要每帧都换一个新对象：
        // 每帧换会让整个 App 跟着重渲染，60fps 下白白吃掉不少 CPU
        const sizeChanged = !meta.value || meta.value.width !== w || meta.value.height !== h
        if (sizeChanged || now - metaPushedAt > META_MIN_GAP) {
          meta.value = buildVideoMeta(w, h)
          metaPushedAt = now
        }
        ready.value = true
        error.value = ''
        lost.value = false
        frameCount.value += 1
        if (prev?.close) {
          try { prev.close() } catch {}
        }
      })
      .catch(() => {})
      .finally(() => {
        converting = false
        try { frame.close() } catch {}
      })
  }

  function handleAccessUnit(data, isKey) {
    // 关键帧里带 SPS，正好用它决定 codec 字符串
    const d = ensureDecoder(isKey ? detectCodec(data) : '')
    if (!d || d.state !== 'configured') return
    // 解码跟不上时主动丢帧，等下一个关键帧自然恢复，避免队列无限堆积
    if (d.decodeQueueSize > 60) return
    try {
      d.decode(
        new EncodedVideoChunk({
          type: isKey ? 'key' : 'delta',
          timestamp: tsUs,
          duration: FRAME_TS_US,
          data,
        }),
      )
      tsUs += FRAME_TS_US
    } catch {
      // 单帧喂失败（多为参数集切换瞬间）不用管，下一帧会自愈
    }
  }

  function handleVideoChunk(bytes) {
    if (!parser) parser = createAnnexBParser(handleAccessUnit)
    parser.push(bytes)
  }

  async function handleBinary(buffer) {
    if (buffer.byteLength < 4) return
    const metaLen = new DataView(buffer).getUint32(0)
    // metaLength = 0 是录屏帧（H.264 裸流），没有 meta
    if (metaLen === 0) {
      handleVideoChunk(new Uint8Array(buffer, 4))
      return
    }
    await handleImageFrame(buffer)
  }

  /* ------------------------------ 连接管理 ------------------------------ */
  function connect(next = {}) {
    options = { ...options, ...next }
    manualClose = false
    clearTimeout(reconnectTimer)
    resetVideoPipeline()
    // 先摘掉旧连接的回调再关闭，避免旧 socket 的 close 触发多余的重连循环
    const previous = ws
    ws = null
    if (previous) {
      previous.onopen = null
      previous.onmessage = null
      previous.onerror = null
      previous.onclose = null
      try { previous.close() } catch {}
    }
    try {
      ws = new WebSocket(buildUrl())
    } catch (err) {
      error.value = err.message
      return
    }
    ws.binaryType = 'arraybuffer'
    ws.onopen = () => {
      error.value = ''
      paused.value = false
    }
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        let msg
        try { msg = JSON.parse(ev.data) } catch { return }
        if (msg.type === 'error') {
          error.value = msg.message
          // 只有「设备确实从 adb 列表里消失」或连续多次抓屏失败才判定为掉线；
          // 单次坏帧（大屏截屏偶发）不算，避免画面来回冻结
          if (msg.deviceGone === true || Number(msg.failCount) >= 3) {
            lost.value = true
          }
        }
        if (msg.type === 'record') {
          if (msg.state === 'starting' || msg.state === 'stream') {
            videoInfo = {
              deviceWidth: Number(msg.deviceWidth) || 0,
              deviceHeight: Number(msg.deviceHeight) || 0,
              bitrate: Number(msg.bitrate) || options.bitrate,
            }
          }
          if (msg.state === 'stream') {
            // 新的一段录屏从关键帧开始，解码器必须重建
            resetVideoPipeline()
            fpsCount = 0
            fpsWindowAt = 0
          }
          if (msg.message && (msg.state === 'error' || msg.state === 'warn' || msg.state === 'fatal')) {
            error.value = msg.message
          }
          if (msg.deviceGone) lost.value = true
          if (msg.state === 'fatal') {
            recordFatal.value = msg.message || '录屏启动失败'
          }
        }
        if (msg.type === 'ready') {
          ready.value = true
          if (msg.mode === 'record') {
            videoInfo = videoInfo || { bitrate: Number(msg.bitrate) || options.bitrate }
          }
        }
        if (msg.type === 'config') paused.value = !!msg.paused
        return
      }
      handleBinary(ev.data)
    }
    ws.onerror = () => {
      error.value = '投屏连接异常，请确认开发服务仍在运行'
    }
    ws.onclose = () => {
      ready.value = false
      if (!manualClose) {
        lost.value = true
        reconnectTimer = setTimeout(() => connect(), 1500)
      }
    }
  }

  function send(payload) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload))
  }

  /** 远程触控：走同一条 WebSocket，拖动时每秒几十个事件也不用额外开 HTTP 请求 */
  function sendTouch(payload) {
    send({ type: 'touch', ...payload })
  }

  function configure(partial) {
    const prevMode = options.mode
    options = { ...options, ...partial }
    // 换设备 / 换画面来源必须重建连接：服务端要换整条管道
    if (partial.serial !== undefined || (partial.mode !== undefined && partial.mode !== prevMode)) {
      connect(partial)
      return
    }
    send({ type: 'config', ...options })
  }

  function pause() {
    paused.value = true
    send({ type: 'pause' })
  }

  function resume() {
    paused.value = false
    send({ type: 'resume' })
  }

  function refreshNow() {
    send({ type: 'snapshot' })
  }

  function close() {
    manualClose = true
    clearTimeout(reconnectTimer)
    if (ws) {
      try { ws.close() } catch {}
      ws = null
    }
    resetVideoPipeline()
    ready.value = false
  }

  onBeforeUnmount(close)

  return {
    bitmap,
    meta,
    ready,
    paused,
    error,
    lost,
    recordFatal,
    frameCount,
    connect,
    configure,
    pause,
    resume,
    refreshNow,
    sendTouch,
    close,
  }
}
