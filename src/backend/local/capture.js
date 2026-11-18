/**
 * 取一帧原始画面（PNG 字节）。
 *
 * 三个来源共用这一条路：真机（screencap）、本地图片数据源、演示模式。
 * 上层（推流 / 取色 / 找色 / 保存）都只认「PNG 字节」，所以三者行为完全一致。
 */
import * as adb from './adb.js'
import { DEMO_SERIAL, renderDemoFrame } from './demo.js'
import { getImage } from './store.js'

const PNG_SIGNATURE = '89504e470d0a1a0a'

export async function capturePng(serial, { timeout = 25000 } = {}) {
  if (serial === DEMO_SERIAL) return renderDemoFrame()
  const image = getImage(serial)
  if (image) return image.bytes

  const bytes = await adb.execBinary(serial, 'screencap -p', { timeout })
  const head = bytes.subarray(0, 8)
  const signature = [...head].map((b) => b.toString(16).padStart(2, '0')).join('')
  if (signature !== PNG_SIGNATURE) {
    const text = new TextDecoder().decode(bytes.subarray(0, 120)).trim()
    throw new Error(
      `截屏数据不是合法 PNG（可能设备未授权或锁屏）：${text.slice(0, 100) || signature || '空数据'}`,
    )
  }
  return bytes
}
