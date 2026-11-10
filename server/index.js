import { WebSocketServer } from 'ws'
import {
  adbConnect,
  adbDisconnect,
  capturePng,
  getAdbVersion,
  getDeviceInfo,
  listDevices,
  runAdb,
  shellKey,
  shellSwipe,
  shellTap,
} from './adb.js'
import {
  cropRegion,
  encodeFrame,
  findColorOnFrame,
  normalizeImage,
  readPixel,
  readSize,
  renderDemoFrame,
} from './frame.js'

const DEMO_SERIAL = 'demo'

/* --------------------- 本地图片数据源（作为伪设备参与取色/找色） --------------------- */
const imageStore = new Map()
const MAX_IMAGES = 4
let imageSeq = 0

function getStoredImage(serial) {
  const img = imageStore.get(serial)
  if (!img) return null
  img.at = Date.now()
  return img.buffer
}

function storeImage(buffer, width, height, name, format) {
  const id = `file:${(++imageSeq).toString(36)}`
  imageStore.set(id, { buffer, width, height, name, format, at: Date.now() })
  while (imageStore.size > MAX_IMAGES) {
    let oldestKey = null
    let oldestAt = Infinity
    for (const [k, v] of imageStore) {
      if (v.at < oldestAt) {
        oldestAt = v.at
        oldestKey = k
      }
    }
    if (!oldestKey) break
    imageStore.delete(oldestKey)
  }
  return id
}

/* ------------------------------ 截屏缓存 ------------------------------ */
const pngCache = new Map() // serial -> { buffer, at, promise }

function getPng(serial, { maxAge = 800, force = false } = {}) {
  const stored = getStoredImage(serial)
  if (stored) return Promise.resolve(stored)

  const hit = pngCache.get(serial)
  if (!force && hit && Date.now() - hit.at < maxAge) return hit.promise

  const promise = (async () => {
    if (serial === DEMO_SERIAL) return renderDemoFrame()
    return capturePng(serial)
  })()

  pngCache.set(serial, { at: Date.now(), promise })
  promise.catch(() => {
    const cur = pngCache.get(serial)
    if (cur && cur.promise === promise) pngCache.delete(serial)
  })
  return promise
}

function sendImage(res, buffer, { contentType = 'image/png', filename = 'image.png' } = {}) {
  res.statusCode = 200
  res.setHeader('Content-Type', contentType)
  res.setHeader('Content-Length', buffer.length)
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`)
  res.end(buffer)
}

/* --------------------------- 帧快照（对应前端所见画面） --------------------------- */
const frameStore = new Map()
const MAX_FRAMES = 6
let frameSeq = 0

function storeFrame(serial, buffer) {
  const id = ++frameSeq
  const list = frameStore.get(serial) || []
  list.push({ id, buffer, at: Date.now() })
  while (list.length > MAX_FRAMES) list.shift()
  frameStore.set(serial, list)
  return id
}

function getFrame(serial, id) {
  if (!id) return null
  const list = frameStore.get(serial) || []
  const hit = list.find((f) => f.id === Number(id))
  return hit ? hit.buffer : null
}

async function resolvePng(serial, frameId) {
  const frame = getFrame(serial, frameId)
  if (frame) return frame
  // 环形缓冲被挤掉时，优先复用最近一次抓取结果，避免每次都重新截屏
  return getPng(serial, { maxAge: 2500 })
}

/* ------------------------------ 工具函数 ------------------------------ */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function sendJson(res, data, status = 200) {
  const body = JSON.stringify(data)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(body)
}

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        reject(new Error(`请求体过大（上限 ${Math.round(limit / 1024 / 1024)}MB）`))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim()
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

async function enrichDevices() {
  const devices = await listDevices()
  const enriched = []
  for (const d of devices) {
    const item = { ...d, label: d.model ? `${d.model} (${d.serial})` : d.serial, ready: d.state === 'device' }
    if (item.ready) {
      try {
        const info = await getDeviceInfo(d.serial)
        item.screen = info.screen
        item.brand = info.brand
        item.androidVersion = info.androidVersion
      } catch {
        item.screen = null
      }
    }
    enriched.push(item)
  }
  enriched.push({
    serial: DEMO_SERIAL,
    state: 'demo',
    kind: 'demo',
    model: '演示模式（无需设备）',
    label: '演示模式（无需设备）',
    ready: true,
    screen: { width: 1080, height: 1920 },
    brand: 'AutoJs6 DevHelper',
    androidVersion: '',
  })
  return enriched
}

/* ------------------------------ 路由处理 ------------------------------ */
async function handleApi(req, res, url) {
  const p = url.pathname
  const q = url.searchParams

  if (p === '/api/env') {
    const env = await getAdbVersion()
    return sendJson(res, { ...env, platform: process.platform, node: process.version })
  }

  if (p === '/api/devices') {
    const env = await getAdbVersion()
    if (!env.ok) return sendJson(res, { ok: false, adb: env, error: env.error, devices: [] })
    try {
      const devices = await enrichDevices()
      return sendJson(res, { ok: true, adb: env, devices })
    } catch (err) {
      return sendJson(res, { ok: false, adb: env, error: err.message, devices: [] })
    }
  }

  if (p === '/api/connect' && req.method === 'POST') {
    const body = await readBody(req)
    if (!body.address) return sendJson(res, { ok: false, error: '缺少 address' }, 400)
    const r = await adbConnect(String(body.address).trim())
    if (r.ok) {
      try { await runAdb(['-s', String(body.address).trim(), 'wait-for-device'], { timeout: 8000 }) } catch {}
    }
    return sendJson(res, r)
  }

  if (p === '/api/disconnect' && req.method === 'POST') {
    const body = await readBody(req)
    const r = await adbDisconnect(String(body.address || '').trim())
    return sendJson(res, r)
  }

  // 上传本地图片作为数据源
  if (p === '/api/image' && req.method === 'POST') {
    const body = await readBody(req, 64 * 1024 * 1024)
    const raw = String(body.dataUrl || '')
    const match = raw.match(/^data:[^;]+;base64,(.+)$/s)
    const base64 = (match ? match[1] : raw).trim()
    if (!base64) return sendJson(res, { ok: false, error: '缺少图片数据' }, 400)

    const buf = Buffer.from(base64, 'base64')
    if (!buf.length) return sendJson(res, { ok: false, error: '图片数据为空' }, 400)

    const normalized = await normalizeImage(buf)
    const name = String(body.name || 'image').slice(0, 120)
    const serial = storeImage(normalized.buffer, normalized.width, normalized.height, name, normalized.format)

    return sendJson(res, {
      ok: true,
      serial,
      name,
      width: normalized.width,
      height: normalized.height,
      format: normalized.format,
      bytes: normalized.buffer.length,
    })
  }

  if (p === '/api/info') {
    const serial = q.get('serial') || DEMO_SERIAL
    if (serial === DEMO_SERIAL) {
      return sendJson(res, {
        ok: true,
        demo: true,
        serial,
        model: '演示模式',
        brand: 'AutoJs6 DevHelper',
        androidVersion: '',
        sdk: '',
        screen: { width: 1080, height: 1920 },
        physical: { width: 1080, height: 1920 },
        override: null,
        density: 480,
      })
    }
    const info = await getDeviceInfo(serial, { force: q.get('force') === '1' })
    return sendJson(res, { ok: true, demo: false, ...info })
  }

  if (p === '/api/snapshot') {
    const serial = q.get('serial') || DEMO_SERIAL
    const png = await getPng(serial, { force: true })
    const frame = await encodeFrame(png, { scale: Number(q.get('scale') || 1) })
    sendImage(res, frame.buffer, {
      contentType: 'image/png',
      filename: `screenshot-${serial}-${Date.now()}.png`,
    })
    return
  }

  // 整屏 / 区域截图（1:1 原始像素，PNG 无损）
  if (p === '/api/shot' && req.method === 'POST') {
    const body = await readBody(req)
    const serial = body.serial || DEMO_SERIAL
    const png = body.fresh ? await getPng(serial, { force: true }) : await resolvePng(serial, body.frameId)
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)

    if (body.region && Number.isFinite(Number(body.region.w ?? body.region.width))) {
      const result = await cropRegion(png, body.region)
      sendImage(res, result.buffer, {
        contentType: 'image/png',
        filename: `region-${result.x},${result.y}-${result.width}x${result.height}-${stamp}.png`,
      })
      return
    }

    // 未指定区域 = 保存整屏：直接把原始 PNG 字节发回去，字节级一致且省一次重编码
    sendImage(res, png, {
      contentType: 'image/png',
      filename: `screenshot-${serial}-${stamp}.png`,
    })
    return
  }

  if (p === '/api/pixel') {
    const serial = q.get('serial') || DEMO_SERIAL
    const x = Number(q.get('x'))
    const y = Number(q.get('y'))
    if (!Number.isFinite(x) || !Number.isFinite(y)) return sendJson(res, { ok: false, error: 'x/y 无效' }, 400)
    const png = await resolvePng(serial, q.get('frame'))
    const px = await readPixel(png, x, y)
    return sendJson(res, { ok: true, ...px })
  }

  if (p === '/api/pick' && req.method === 'POST') {
    const body = await readBody(req)
    const serial = body.serial || DEMO_SERIAL
    const png = await resolvePng(serial, body.frameId)
    const px = await readPixel(png, Number(body.x), Number(body.y))
    return sendJson(res, { ok: true, ...px })
  }

  if (p === '/api/findColor' && req.method === 'POST') {
    const body = await readBody(req)
    const serial = body.serial || DEMO_SERIAL
    const png = await resolvePng(serial, body.frameId)
    const result = await findColorOnFrame(png, {
      color: body.color,
      threshold: body.threshold ?? 4,
      region: body.region || null,
      limit: body.limit ?? 500,
    })
    return sendJson(res, { ok: true, ...result })
  }

  if (p === '/api/tap' && req.method === 'POST') {
    const body = await readBody(req)
    if (body.serial === DEMO_SERIAL) return sendJson(res, { ok: true, message: '演示模式：已模拟点击' })
    const r = await shellTap(body.serial, Math.round(body.x), Math.round(body.y))
    return sendJson(res, { ok: r.ok, message: r.message || `tap ${body.x},${body.y}` })
  }

  if (p === '/api/swipe' && req.method === 'POST') {
    const body = await readBody(req)
    if (body.serial === DEMO_SERIAL) return sendJson(res, { ok: true, message: '演示模式：已模拟滑动' })
    const r = await shellSwipe(body.serial, {
      x1: Math.round(body.x1),
      y1: Math.round(body.y1),
      x2: Math.round(body.x2),
      y2: Math.round(body.y2),
      duration: Math.round(body.duration ?? 300),
    })
    return sendJson(res, { ok: r.ok, message: r.message || 'swipe done' })
  }

  if (p === '/api/key' && req.method === 'POST') {
    const body = await readBody(req)
    if (body.serial === DEMO_SERIAL) return sendJson(res, { ok: true, message: `演示模式：已模拟按键 ${body.key}` })
    const r = await shellKey(body.serial, body.key)
    return sendJson(res, { ok: r.ok, message: r.message || `key ${body.key}` })
  }

  if (p === '/api/size') {
    const serial = q.get('serial') || DEMO_SERIAL
    const png = await getPng(serial, { maxAge: 800 })
    const size = await readSize(png)
    return sendJson(res, { ok: true, ...size })
  }

  return sendJson(res, { ok: false, error: `未知接口：${p}` }, 404)
}

/* ------------------------------ WebSocket 推流 ------------------------------ */
function attachWebSocket(httpServer) {
  const wss = new WebSocketServer({ noServer: true })

  httpServer.on('upgrade', (req, socket, head) => {
    let url
    try {
      url = new URL(req.url, 'http://127.0.0.1')
    } catch {
      return
    }
    if (url.pathname !== '/ws/screen') return
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, url))
  })

  wss.on('connection', (ws, req, url) => {
    let serial = url.searchParams.get('serial') || DEMO_SERIAL
    const levelParam = Number(url.searchParams.get('level'))
    const cfg = {
      fps: Math.max(1, Math.min(10, Number(url.searchParams.get('fps')) || 2)),
      scale: Math.max(1, Math.min(8, Math.round(Number(url.searchParams.get('scale')) || 3))),
      compressionLevel: Number.isFinite(levelParam) ? Math.max(0, Math.min(9, Math.round(levelParam))) : 3,
      paused: false,
    }
    let closed = false
    let lastFrameAt = 0
    let smoothedFps = 0

    const send = (obj) => {
      if (!closed && ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj))
    }

    const sendFrame = (pngFrame, meta) => {
      if (closed || ws.readyState !== ws.OPEN) return
      const metaBuf = Buffer.from(JSON.stringify(meta), 'utf8')
      const header = Buffer.alloc(4)
      header.writeUInt32BE(metaBuf.length, 0)
      ws.send(Buffer.concat([header, metaBuf, pngFrame]), { binary: true })
    }

    ws.on('message', (raw) => {
      let msg
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return
      }
      if (msg.type === 'config') {
        if (Number.isFinite(msg.fps)) cfg.fps = Math.max(0.5, Math.min(15, msg.fps))
        if (Number.isFinite(msg.scale)) cfg.scale = Math.max(1, Math.min(6, Math.round(msg.scale)))
        if (Number.isFinite(msg.level)) cfg.compressionLevel = Math.max(0, Math.min(9, Math.round(msg.level)))
        if (msg.serial && msg.serial !== serial) {
          serial = msg.serial
          pngCache.delete(serial)
        }
        send({ type: 'config', ...cfg, serial })
        return
      }
      if (msg.type === 'pause') {
        cfg.paused = true
        send({ type: 'config', ...cfg, serial })
        return
      }
      if (msg.type === 'resume') {
        cfg.paused = false
        send({ type: 'config', ...cfg, serial })
        return
      }
      if (msg.type === 'snapshot') {
        pngCache.delete(serial)
        lastFrameAt = 0
      }
    })

    ws.on('close', () => {
      closed = true
    })
    ws.on('error', () => {
      closed = true
    })

    send({ type: 'ready', serial, ...cfg })

    ;(async () => {
      while (!closed) {
        if (cfg.paused) {
          await sleep(150)
          continue
        }
        const t0 = Date.now()
        try {
          const png = serial === DEMO_SERIAL ? await getPng(serial, { maxAge: 0, force: true }) : await capturePng(serial)
          if (closed) break
          const frameId = storeFrame(serial, png)
          // 同步刷新缓存，使「取色 / 找色」在帧被淘汰时可秒回
          pngCache.set(serial, { at: Date.now(), promise: Promise.resolve(png) })
          const frame = await encodeFrame(png, { scale: cfg.scale, compressionLevel: cfg.compressionLevel })
          const now = Date.now()
          if (lastFrameAt) {
            const inst = 1000 / Math.max(1, now - lastFrameAt)
            smoothedFps = smoothedFps ? smoothedFps * 0.7 + inst * 0.3 : inst
          }
          const capturedAt = now
          lastFrameAt = now
          sendFrame(frame.buffer, {
            serial,
            frameId,
            width: frame.width,
            height: frame.height,
            deviceWidth: frame.deviceWidth,
            deviceHeight: frame.deviceHeight,
            scale: frame.scale,
            format: 'png',
            ts: now,
            cost: now - t0,
            fps: Number(smoothedFps.toFixed(1)),
          })
        } catch (err) {
          send({ type: 'error', message: err.message || String(err), serial })
          await sleep(1000)
          continue
        }
        const interval = 1000 / cfg.fps
        const elapsed = Date.now() - t0
        await sleep(Math.max(40, interval - elapsed))
      }
    })()
  })

  return wss
}

/* ------------------------------ 插件导出 ------------------------------ */
export function adbHelperPlugin() {
  let attached = false

  return {
    name: 'autojs6-adb-helper',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/')) return next()
        const url = new URL(req.url, 'http://127.0.0.1')
        const t0 = Date.now()
        let logged = false
        const done = () => {
          if (logged || process.env.ADB_HELPER_LOG === '0') return
          logged = true
          server.config.logger.info(
            `  [adb-helper] ${req.method} ${url.pathname}${url.search.slice(0, 80)} ` +
              `→ ${res.statusCode} ${Date.now() - t0}ms`,
          )
        }
        res.once('finish', done)
        res.once('close', done)
        try {
          await handleApi(req, res, url)
        } catch (err) {
          server.config.logger.error(`  [adb-helper] ${url.pathname} 失败：${err.message}`)
          if (!res.headersSent) sendJson(res, { ok: false, error: err.message || String(err) }, 500)
          else res.end()
        }
      })

      const attach = () => {
        if (attached || !server.httpServer) return
        attached = true
        // 避免 keep-alive 空闲连接被 Node 提前回收后，浏览器复用失效 socket 导致请求失败
        server.httpServer.keepAliveTimeout = 120000
        server.httpServer.headersTimeout = 125000
        attachWebSocket(server.httpServer)
        server.config.logger.info('\n  \x1b[36m➜\x1b[0m  ADB 辅助服务已就绪：/api/*  ·  /ws/screen\n')
      }
      if (server.httpServer) attach()
      else server.httpServer?.once?.('listening', attach)
      server.httpServer?.on('listening', attach)
    },
  }
}

export { DEMO_SERIAL }
