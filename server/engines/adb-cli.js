/**
 * 连接引擎：ADB 命令（platform-tools）
 *
 * 传统的做法 —— 每条命令起一个 adb 客户端进程。
 * 同时也是唯一支持「无线调试 / mDNS 发现 / 配对」的引擎，因为这些能力长在 adb 自己身上。
 */
import {
  capturePng,
  getAdbVersion,
  getDeviceInfo,
  listDevices,
  mdnsCheck,
  mdnsServices,
  adbConnect,
  adbDisconnect,
  adbPair,
  openShell,
  runAdb,
  shellDragAndDrop,
  shellKey,
  shellSwipe,
  shellTap,
} from '../adb.js'
import { spawnScreenRecord } from '../record.js'

export const id = 'adb'
export const label = 'ADB 命令'
export const short = 'ADB'
export const desc = '通过 platform-tools 的 adb 命令访问设备，支持无线调试与局域网自动发现'
export const capabilities = { usb: true, wireless: true, mdns: true }

export async function probe() {
  const env = await getAdbVersion()
  return {
    ok: !!env.ok,
    detail: env.version || '',
    adbPath: env.adbPath || '',
    error: env.error || '',
    hint: env.ok ? '' : '安装 Android Platform Tools 并加入 PATH，或设置环境变量 ADB_PATH',
  }
}

export const devices = listDevices
export const info = getDeviceInfo
export const screenshot = capturePng
export const shell = openShell
export const record = spawnScreenRecord

/** 跑一条 shell 命令并等结果：锁屏 / 解锁这类需要看返回文本的场景用 */
export async function shellText(serial, command, { timeout = 12000 } = {}) {
  const r = await runAdb(['-s', serial, 'shell', command], { timeout })
  return { code: r.code, text: `${r.text}${r.stderr}` }
}

export const tap = shellTap
export const swipe = shellSwipe
export const dragDrop = shellDragAndDrop
export const key = shellKey

export const pair = adbPair
export const connect = adbConnect
export const disconnect = adbDisconnect
export const mdns = { check: mdnsCheck, services: mdnsServices }
