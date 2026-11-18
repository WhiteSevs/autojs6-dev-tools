/**
 * 本地推流会话：画面数据不再经 WebSocket 绕一圈，直接在本页生成。
 *
 * 对外表现出和 /ws/screen 一模一样的「线格式」，useStream 那边不用区分来源：
 *  - 截图帧：[4 字节 meta 长度][meta JSON][PNG]
 *  - 录屏帧：4 字节 0 + H.264 裸流（前端用 WebCodecs 解码）
 *  - 控制消息：JSON 文本，字段和 service 端一致
 *
 * 所以这里本质上是个「跑在浏览器里的服务端」，逻辑也刻意照着 server/index.js 的
 * runCaptureLoop / runRecordLoop 写 —— 两条引擎的画面手感（帧率、重连、回退）才对得上。
 */
import * as adb from './adb.js'
import { capturePng } from './capture.js'
import { DEMO_SERIAL } from './demo.js'
import { buildScreenRecordCommand, fitRecordSize, looksLikeArgError } from './record.js'
import { pngSize, scalePng } from './raster.js'
import { storeFrame } from './store.js'
import { releaseTouch, touchEvent } from './touch.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function textEncoder() {
  return new TextEncoder()
}

/** [4B metaLen][meta][PNG] */
function framePacket(meta, pngBytes) {
  const metaBytes = textEncoder().encode(JSON.stringify(meta))
  const out = new Uint8Array(4 + metaBytes.length + pngBytes.length)
  new DataView(out.buffer).setUint32(0, metaBytes.length)
  out.set(metaBytes, 4)
  out.set(pngBytes, 4 + metaBytes.length)
  return out.buffer
}

/** [4B 0][H.264 chunk] */
function videoPacket(chunk) {
  const out = new Uint8Array(4 + chunk.length)
  out.set(chunk, 4)
  return out.buffer
}

export function openLocalStream(initial, handlers) {
  const cfg = {
    serial: initial.serial || DEMO_SERIAL,
    mode: initial.mode === 'record' ? 'record' : 'shot',
    fps: Math.max(1, Math.min(15, Number(initial.fps) || 2)),
    scale: Math.max(1, Math.min(8, Math.round(Number(initial.scale) || 1))),
    bitrate: Number(initial.bitrate) || 8_000_000,
    paused: false,
  }

  let closed = false
  /** 管道版本号：改参数 / 换来源时 +1，旧循环自行退出 */
  let token = 0
  let session = null
  let recordStyle = 'eq'
  let recordFails = 0

  const emit = (obj) => {
    if (!closed) handlers.onText?.(obj)
  }
  const emitBinary = (buffer) => {
    if (!closed) handlers.onBinary?.(buffer)
  }

  function restartPipeline() {
    token += 1
    if (session) {
      try {
        session.kill()
      } catch {}
      session = null
    }
    const my = token
    if (cfg.mode === 'record' && cfg.serial !== DEMO_SERIAL) runRecordLoop(my)
    else runCaptureLoop(my)
  }

  /* ------------------------- 画面来源 1：逐帧截图 ------------------------- */
  async function runCaptureLoop(my) {
    let lastAt = 0
    let smoothedFps = 0
    let failCount = 0

    while (!closed && my === token) {
      if (cfg.paused) {
        await sleep(150)
        continue
      }
      const t0 = performance.now()
      try {
        const png = await capturePng(cfg.serial)
        if (closed || my !== token) break
        const frameId = storeFrame(cfg.serial, png)
        const scaled = await scalePng(png, cfg.scale)
        if (closed || my !== token) break

        failCount = 0
        const now = performance.now()
        if (lastAt) {
          const inst = 1000 / Math.max(1, now - lastAt)
          smoothedFps = smoothedFps ? smoothedFps * 0.7 + inst * 0.3 : inst
        }
        lastAt = now
        emitBinary(
          framePacket(
            {
              serial: cfg.serial,
              frameId,
              width: scaled.width,
              height: scaled.height,
              deviceWidth: scaled.deviceWidth,
              deviceHeight: scaled.deviceHeight,
              scale: scaled.scale,
              format: 'png',
              mode: 'screencap',
              ts: Date.now(),
              cost: Math.round(now - t0),
              fps: Number(smoothedFps.toFixed(1)),
            },
            scaled.bytes,
          ),
        )
      } catch (err) {
        failCount += 1
        // 抓屏失败可能是设备掉了，也可能只是一次抖动（大屏截屏偶发坏帧）
        let deviceGone = false
        if (cfg.serial !== DEMO_SERIAL) {
          try {
            const list = await adb.listDevices()
            deviceGone = !list.some((d) => d.serial === cfg.serial)
          } catch {
            deviceGone = true
          }
        }
        emit({
          type: 'error',
          message: err.message || String(err),
          serial: cfg.serial,
          failCount,
          deviceGone,
        })
        await sleep(deviceGone ? 1500 : 800)
        continue
      }
      const interval = 1000 / cfg.fps
      const elapsed = performance.now() - t0
      await sleep(Math.max(40, interval - elapsed))
    }
  }

  /* ------------------------- 画面来源 2：屏幕录制 ------------------------- */
  async function runRecordLoop(my) {
    // 先量一次「当前旋转下的真实画面尺寸」：wm size 给的是面板物理尺寸，横屏时不换向
    let display = null
    try {
      display = pngSize(await capturePng(cfg.serial))
    } catch {}
    if (closed || my !== token) return

    const deviceWidth = display?.width || 0
    const deviceHeight = display?.height || 0
    emit({ type: 'record', state: 'starting', serial: cfg.serial, bitrate: cfg.bitrate, deviceWidth, deviceHeight })

    while (!closed && my === token) {
      const size = fitRecordSize(display, cfg.scale)
      const startedAt = Date.now()
      let bytes = 0
      let killed = false
      let announced = false
      let stderr = ''

      let stream
      try {
        stream = await adb.spawnStream(
          cfg.serial,
          buildScreenRecordCommand({ bitrate: cfg.bitrate, size, style: recordStyle }),
          {
            onChunk: (chunk) => {
              if (closed || my !== token) return
              bytes += chunk.length
              if (!announced) {
                announced = true
                emit({
                  type: 'record',
                  state: 'stream',
                  width: size?.width || deviceWidth,
                  height: size?.height || deviceHeight,
                  deviceWidth,
                  deviceHeight,
                  bitrate: cfg.bitrate,
                })
              }
              emitBinary(videoPacket(chunk))
            },
          },
        )
      } catch (err) {
        emit({ type: 'record', state: 'fatal', message: `无法启动 screenrecord：${err.message}` })
        return
      }

      session = {
        kill() {
          killed = true
          stream.kill()
        },
      }

      // 等这一段录屏结束：kill 之后 stdout 会立刻收尾，不会真的等到 180 秒
      const res = await stream.done
      session = null
      if (closed || my !== token) return

      stderr = stream.stderr || ''
      const errText = String(stderr).trim()
      const lived = Date.now() - startedAt
      if (bytes > 0) recordFails = 0

      if (killed) {
        emit({ type: 'record', state: 'restart', message: '画面参数已更新，重新开始录屏' })
        continue
      }
      if (bytes > 0 && res.code === 0) {
        emit({ type: 'record', state: 'restart' })
        await sleep(120)
        continue
      }
      if (bytes > 0 && lived >= 5000) {
        emit({ type: 'record', state: 'restart' })
        await sleep(300)
        continue
      }

      recordFails += 1
      // 老版本 screenrecord 只认 --key value 写法，换个写法再试一次
      if (bytes === 0 && recordFails <= 2 && looksLikeArgError(errText)) {
        recordStyle = recordStyle === 'eq' ? 'two' : 'eq'
        continue
      }

      let deviceGone = false
      try {
        const list = await adb.listDevices()
        deviceGone = !list.some((d) => d.serial === cfg.serial)
      } catch {
        deviceGone = true
      }

      const message = errText || `screenrecord 退出（code ${res.code}）`
      emit({ type: 'record', state: 'error', message, deviceGone, bitrate: cfg.bitrate })

      if (deviceGone) {
        await sleep(1500)
        continue
      }
      if (recordFails >= 3) {
        emit({ type: 'record', state: 'fatal', message })
        return
      }
      await sleep(Math.min(2500, 500 * recordFails))
    }
  }

  function send(msg) {
    if (!msg || closed) return
    if (msg.type === 'config') {
      const prevMode = cfg.mode
      const prevScale = cfg.scale
      const prevBitrate = cfg.bitrate
      const prevSerial = cfg.serial
      if (Number.isFinite(msg.fps)) cfg.fps = Math.max(0.5, Math.min(15, msg.fps))
      if (Number.isFinite(msg.scale)) cfg.scale = Math.max(1, Math.min(6, Math.round(msg.scale)))
      if (msg.bitrate !== undefined) cfg.bitrate = Number(msg.bitrate) || cfg.bitrate
      if (msg.mode === 'record' || msg.mode === 'shot') cfg.mode = msg.mode
      if (msg.serial && msg.serial !== cfg.serial) {
        cfg.serial = msg.serial
      }
      emit({ type: 'config', ...cfg })
      const dirty =
        prevMode !== cfg.mode ||
        prevSerial !== cfg.serial ||
        (cfg.mode === 'record' && (prevScale !== cfg.scale || prevBitrate !== cfg.bitrate))
      if (dirty) restartPipeline()
      return
    }
    if (msg.type === 'pause') {
      cfg.paused = true
      emit({ type: 'config', ...cfg })
      return
    }
    if (msg.type === 'resume') {
      cfg.paused = false
      emit({ type: 'config', ...cfg })
      return
    }
    if (msg.type === 'snapshot') return
    if (msg.type === 'touch') {
      if (cfg.serial === DEMO_SERIAL || !msg.phase) return
      const r = touchEvent(cfg.serial, { phase: msg.phase, x: msg.x, y: msg.y })
      if (!r.ok) emit({ type: 'error', message: `触控失败：${r.error}`, serial: cfg.serial })
      return
    }
    if (msg.type === 'record-restart') {
      if (cfg.mode === 'record' && cfg.serial !== DEMO_SERIAL) restartPipeline()
    }
  }

  function close() {
    if (closed) return
    closed = true
    token += 1
    if (session) {
      try {
        session.kill()
      } catch {}
      session = null
    }
    releaseTouch(cfg.serial)
  }

  emit({ type: 'ready', serial: cfg.serial, ...cfg })
  restartPipeline()

  return { send, close }
}
