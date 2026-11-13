/**
 * 极简 Annex-B（H.264 裸流）解析器。
 *
 * adb screenrecord 的输出没有容器，只有 `00 00 01` 分隔的 NAL。Annex-B 不写长度前缀，
 * 因此只能靠「下一个起始码出现」来判断上一个 NAL 是否收完 —— 最后一个 NAL 会延后一块
 * 数据再输出（约 10~30ms 延迟，换来不丢帧）。
 *
 * 输出单位是访问单元（AU，即一帧），因为 WebCodecs 的 EncodedVideoChunk 需要一次性拿到
 * 该帧的全部 NAL（SPS/PPS/SEI/slice），否则解码器会报错。
 */

const MAX_CARRY = 4 * 1024 * 1024

function concat(a, b) {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

/**
 * @param {(data: Uint8Array, isKey: boolean) => void} onAccessUnit 每凑齐一帧回调一次
 */
export function createAnnexBParser(onAccessUnit) {
  let carry = null
  let nalList = []
  let hasVcl = false

  function flush() {
    const list = nalList
    const hadVcl = hasVcl
    nalList = []
    hasVcl = false
    if (!hadVcl) return // 纯 SPS/PPS 的包先攒着，等真正的帧一起交出去

    let total = 0
    for (const nal of list) total += nal.length + 4
    const out = new Uint8Array(total)
    let off = 0
    let isKey = false
    for (const nal of list) {
      out[off++] = 0
      out[off++] = 0
      out[off++] = 0
      out[off++] = 1
      out.set(nal, off)
      off += nal.length
      if ((nal[0] & 0x1f) === 5) isKey = true
    }
    onAccessUnit(out, isKey)
  }

  function takeNal(view) {
    if (!view.length) return
    const type = view[0] & 0x1f
    if (!type) return
    const isVcl = type === 1 || type === 5
    // 已经收到过 slice，又见到 slice / SEI / SPS / PPS / AUD，说明下一帧开始了
    if (hasVcl && (isVcl || type === 6 || type === 7 || type === 8 || type === 9)) flush()
    nalList.push(view)
    if (isVcl) hasVcl = true
  }

  function push(chunk) {
    const data = carry && carry.length ? concat(carry, chunk) : chunk
    carry = null

    let start = -1
    for (let i = 0; i + 2 < data.length; i++) {
      if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
        if (start >= 0) takeNal(data.subarray(start, i))
        start = i + 3
        i += 2
      }
    }

    if (start >= 0) {
      // 连起始码一起留到下一块：下次拼接后仍能从 0 位置认出这是同一个 NAL
      carry = data.subarray(start - 3)
    } else {
      carry = data.length > MAX_CARRY ? null : data
    }
  }

  function reset() {
    carry = null
    nalList = []
    hasVcl = false
  }

  return { push, reset }
}
