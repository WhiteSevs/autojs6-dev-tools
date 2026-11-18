/**
 * 前端自己的「服务端状态」：帧缓冲、图片数据源、解码缓存。
 *
 * 服务端保留最近 6 帧原始截图，前端请求带上 frameId 就能命中「你正在看的那一帧」。
 * 纯前端要保住同样的语义 —— 否则冻结画面后取色 / 保存会拿到下一帧，颜色和选区对不上。
 */

/** serial -> [{ id, bytes, at }]，最多留 6 帧 */
const frames = new Map()
const MAX_FRAMES = 6
let frameSeq = 0

export function storeFrame(serial, bytes) {
  const id = ++frameSeq
  const list = frames.get(serial) || []
  list.push({ id, bytes, at: Date.now() })
  while (list.length > MAX_FRAMES) list.shift()
  frames.set(serial, list)
  return id
}

export function getFrame(serial, id) {
  if (id == null) return null
  const list = frames.get(serial) || []
  return list.find((f) => f.id === Number(id))?.bytes || null
}

export function latestFrame(serial, maxAge = 0) {
  const list = frames.get(serial) || []
  const last = list[list.length - 1]
  if (!last) return null
  if (maxAge > 0 && Date.now() - last.at > maxAge) return null
  return last.bytes
}

export function clearFrames(serial) {
  if (serial) frames.delete(serial)
  else frames.clear()
}

/* ------------------------------ 图片数据源 ------------------------------ */
/** serial（file:xxx） -> { bytes, width, height, name, at } */
const images = new Map()
const MAX_IMAGES = 4
let imageSeq = 0

export function storeImage(bytes, { width, height, name }) {
  const id = `file:${(++imageSeq).toString(36)}`
  images.set(id, { bytes, width, height, name, at: Date.now() })
  while (images.size > MAX_IMAGES) {
    let oldestKey = null
    let oldestAt = Infinity
    for (const [k, v] of images) {
      if (v.at < oldestAt) {
        oldestAt = v.at
        oldestKey = k
      }
    }
    if (!oldestKey) break
    images.delete(oldestKey)
  }
  return id
}

export function getImage(serial) {
  const hit = images.get(serial)
  if (!hit) return null
  hit.at = Date.now()
  return hit
}

/* ------------------------------ 解码缓存 ------------------------------ */
/**
 * 帧字节 -> ImageData 的缓存。
 * 找色会随容差反复重扫同一帧，解码一次就够；用 WeakMap 挂在字节对象上，
 * 帧被环形缓冲淘汰后自然被 GC 回收，不用自己数容量。
 */
const imageDataCache = new WeakMap()

export function cachedImageData(bytes, loader) {
  const hit = imageDataCache.get(bytes)
  if (hit) return Promise.resolve(hit)
  return loader().then((data) => {
    imageDataCache.set(bytes, data)
    return data
  })
}
