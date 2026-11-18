/**
 * 前端对外的统一入口。
 *
 * 具体走哪条后端（开发服务器 / 浏览器 USB 直连）由 ./backend/index.js 决定，
 * 组件只从这儿拿 api / shotBlob，以及几个纯浏览器的小工具。
 */
export { api, boot, dispose, runtime, setEngine, shotBlob } from './backend/index.js'

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
