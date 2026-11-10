import { onBeforeUnmount, ref, shallowRef } from 'vue'

/**
 * 实时投屏：与 /ws/screen 建立 WebSocket，接收二进制帧
 * 帧格式：[4字节 metaLength][metaJSON][png]（PNG 无损，预览像素 = 取色像素）
 */
export function useStream() {
  const bitmap = shallowRef(null)
  const meta = ref(null)
  const ready = ref(false)
  const paused = ref(false)
  const error = ref('')
  const frameCount = ref(0)

  let ws = null
  let options = { serial: null, fps: 2, scale: 3 }
  let manualClose = false
  let reconnectTimer = null
  let decoding = false
  let lastWantTs = 0

  function buildUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const q = new URLSearchParams({
      serial: options.serial || 'demo',
      fps: String(options.fps),
      scale: String(options.scale),
      level: String(options.level ?? 3),
    })
    return `${proto}//${location.host}/ws/screen?${q.toString()}`
  }

  async function handleBinary(buffer) {
    if (decoding) return
    decoding = true
    try {
      const view = new DataView(buffer)
      const metaLen = view.getUint32(0)
      const metaText = new TextDecoder().decode(new Uint8Array(buffer, 4, metaLen))
      const frameMeta = JSON.parse(metaText)
      const pngBytes = new Uint8Array(buffer, 4 + metaLen)
      const blob = new Blob([pngBytes], { type: 'image/png' })
      const bmp = await createImageBitmap(blob)
      const prev = bitmap.value
      bitmap.value = bmp
      meta.value = frameMeta
      ready.value = true
      error.value = ''
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

  function connect(next = {}) {
    options = { ...options, ...next }
    manualClose = false
    if (ws) {
      try { ws.close() } catch {}
      ws = null
    }
    clearTimeout(reconnectTimer)
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
        if (msg.type === 'error') error.value = msg.message
        if (msg.type === 'ready') ready.value = true
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
        reconnectTimer = setTimeout(() => connect(), 1500)
      }
    }
  }

  function send(payload) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload))
  }

  function configure(partial) {
    options = { ...options, ...partial }
    if (partial.serial !== undefined) {
      // 切换设备：重建连接，避免延续旧设备缓存
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
    lastWantTs = Date.now()
    send({ type: 'snapshot' })
  }

  function close() {
    manualClose = true
    clearTimeout(reconnectTimer)
    if (ws) {
      try { ws.close() } catch {}
      ws = null
    }
    ready.value = false
  }

  onBeforeUnmount(close)

  return { bitmap, meta, ready, paused, error, frameCount, connect, configure, pause, resume, refreshNow, close }
}
