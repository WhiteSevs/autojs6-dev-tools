const BASE = ''

async function attempt(url, options) {
  return fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
}

async function request(path, options = {}) {
  const url = BASE + path
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

export const api = {
  env: () => request('/api/env'),
  devices: () => request('/api/devices'),
  connect: (address) => request('/api/connect', { method: 'POST', body: JSON.stringify({ address }) }),
  disconnect: (address) => request('/api/disconnect', { method: 'POST', body: JSON.stringify({ address }) }),
  info: (serial) => request(`/api/info?serial=${encodeURIComponent(serial)}`),
  pixel: (serial, x, y, frameId) =>
    request('/api/pick', {
      method: 'POST',
      body: JSON.stringify({ serial, x: Math.round(x), y: Math.round(y), frameId }),
    }),
  findColor: (payload) => request('/api/findColor', { method: 'POST', body: JSON.stringify(payload) }),
  tap: (serial, x, y) =>
    request('/api/tap', { method: 'POST', body: JSON.stringify({ serial, x, y }) }),
  swipe: (payload) => request('/api/swipe', { method: 'POST', body: JSON.stringify(payload) }),
  key: (serial, key) => request('/api/key', { method: 'POST', body: JSON.stringify({ serial, key }) }),
  uploadImage: (payload) => request('/api/image', { method: 'POST', body: JSON.stringify(payload) }),
  snapshotUrl: (serial, scale = 1) =>
    `/api/snapshot?serial=${encodeURIComponent(serial)}&scale=${scale}&t=${Date.now()}`,
}

/**
 * 按 1:1 原始像素导出截图（整屏或指定区域）
 * @returns {Promise<Blob>} PNG（无损）
 */
export async function shotBlob(payload) {
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

/** 触发浏览器下载 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

/**
 * 把图片写入剪贴板。
 * 传入 Promise<Blob> 时 ClipboardItem 会等待它 resolve，
 * 这样 write() 能在用户手势有效期内被调用 —— 否则先 await 网络再写会丢手势，报 NotAllowedError。
 */
export async function copyImageToClipboard(pending) {
  if (!navigator.clipboard || !window.ClipboardItem) {
    throw new Error('当前浏览器不支持图片剪贴板，请改用保存')
  }
  const pngPromise = Promise.resolve(pending).then((blob) =>
    blob.type === 'image/png' ? blob : new Blob([blob], { type: 'image/png' }),
  )
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngPromise })])
}

export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {}
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
