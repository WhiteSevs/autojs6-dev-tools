import { spawn } from 'node:child_process'

const ADB_BIN = process.env.ADB_PATH || 'adb'

/** screenrecord 单次最长录制时长（系统上限就是 180s，到点后由调用方续录） */
export const RECORD_TIME_LIMIT = 180

/**
 * 计算 screenrecord 的 --size。
 * 硬件编码器普遍要求宽高 16 对齐，这里按下采样倍率对齐后再交回去；
 * 倍率为 1（原画）时返回 null，让设备用原生分辨率录制。
 */
export function fitRecordSize(screen, scale) {
  const s = Math.max(1, Math.round(Number(scale) || 1))
  const w = Number(screen?.width) || 0
  const h = Number(screen?.height) || 0
  if (s <= 1 || !w || !h) return null
  const align = (v) => Math.max(16, Math.round(v / 16) * 16)
  const width = align(w / s)
  const height = align(h / s)
  if (width >= w || height >= h) return null
  return { width, height }
}

/**
 * 启动一个 screenrecord 进程，把 H.264 裸流写到 stdout。
 * style: 'eq' 走 --key=value 写法，'two' 走 --key value 写法 ——
 * 不同 Android 版本的 screenrecord 只认其中一种，失败时由上层换一种重试。
 */
export function spawnScreenRecord(serial, { bitrate = 8_000_000, size = null, style = 'eq' } = {}) {
  const args = ['-s', serial, 'exec-out', 'screenrecord']
  const opt = (name, value) => {
    if (style === 'two') args.push(`--${name}`, String(value))
    else args.push(`--${name}=${value}`)
  }
  opt('output-format', 'h264')
  if (bitrate) opt('bit-rate', Math.round(bitrate))
  if (size) opt('size', `${size.width}x${size.height}`)
  opt('time-limit', RECORD_TIME_LIMIT)
  // 文件名用 - 表示写 stdout（h264 裸流才能管道输出，mp4 需要可 seek 的文件）
  args.push('-')

  return spawn(ADB_BIN, args, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  })
}

/** 判断 screenrecord 是否只是「参数写法不被这个版本支持」 */
export function looksLikeArgError(text) {
  return /unknown argument|unrecognized|requires an argument|invalid option|usage:/i.test(String(text || ''))
}
