/**
 * 服务端后端（Vite 开发服务器里的 /api/*）。
 *
 * 只有「ADB 命令」引擎走这里：它要起 adb 进程、读本机 ~/.android/adbkey，
 * 这些事浏览器做不了。「USB 直连」已经全部搬到前端（见 ./local/），
 * 所以纯静态部署时这个模块整体用不上。
 */

async function attempt(url, options) {
  return fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
}

async function request(path, options = {}) {
  const url = path
  let res
  try {
    res = await attempt(url, options)
  } catch (err) {
    // 开发服务器回收空闲连接后，浏览器复用失效 socket 会抛 TypeError，重试一次即可
    try {
      await new Promise((r) => setTimeout(r, 120))
      res = await attempt(url, options)
    } catch (err2) {
      throw new Error(`请求 ${url} 失败：${err2.message}`)
    }
  }
  const text = await res.text()
  let data
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    throw new Error(`返回内容不是 JSON：${text.slice(0, 120)}`)
  }
  if (!res.ok && data.ok !== false) {
    throw new Error(data.error || `请求失败（HTTP ${res.status}）`)
  }
  if (data.ok === false) throw new Error(data.error || '请求失败')
  return data
}

function post(path, body) {
  return request(path, { method: 'POST', body: JSON.stringify(body || {}) })
}

export const http = {
  env: () => request('/api/env'),
  /** 连接引擎状态：{ current, engines: [...] } */
  settings: () => request('/api/settings'),
  devices: () => request('/api/devices'),
  mdns: (refresh = false) => request(`/api/mdns${refresh ? '?refresh=1' : ''}`),
  pair: (address, code) => post('/api/pair', { address, code }),
  connect: (address) => post('/api/connect', { address }),
  disconnect: (address) => post('/api/disconnect', { address }),
  /** 让服务端执行 adb kill-server：USB 接口被 adb server 握着时 WebUSB claim 不到 */
  releaseAdb: () => post('/api/release-adb'),
  info: (serial) => request(`/api/info?serial=${encodeURIComponent(serial)}`),
  pixel: (serial, x, y, frameId, fresh) =>
    post('/api/pick', { serial, x: Math.round(x), y: Math.round(y), frameId, fresh: !!fresh }),
  findColor: (payload) => post('/api/findColor', payload),
  tap: (serial, x, y) => post('/api/tap', { serial, x, y }),
  swipe: (payload) => post('/api/swipe', payload),
  drag: (payload) => post('/api/drag', payload),
  key: (serial, key) => post('/api/key', { serial, key }),
  screen: (serial, action) => post('/api/screen', { serial, action }),
  uploadImage: (payload) => post('/api/image', payload),
  snapshotUrl: (serial, scale = 1) =>
    `/api/snapshot?serial=${encodeURIComponent(serial)}&scale=${scale}&t=${Date.now()}`,
}

/** 按 1:1 原始像素导出截图（整屏或指定区域），返回 PNG Blob */
export async function httpShotBlob(payload) {
  const url = '/api/shot'
  const options = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }
  let res
  try {
    res = await fetch(url, options)
  } catch {
    await new Promise((r) => setTimeout(r, 150))
    res = await fetch(url, options)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let message = text
    try {
      message = JSON.parse(text).error || text
    } catch {}
    throw new Error(message || `截图失败（HTTP ${res.status}）`)
  }
  return res.blob()
}
