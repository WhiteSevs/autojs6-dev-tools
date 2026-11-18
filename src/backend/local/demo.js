/**
 * 演示模式：没有真机时生成一块会动的模拟屏幕。
 *
 * 纯前端版本用 Canvas 画（服务端那份是 SVG + sharp），画面内容保持一致：
 * 渐变底 + 时间 + 几个色块 + 一个动态红点，方便直接验证找色 / 框选 / 保存整条链路。
 */
import { canvasToBytes, createCanvas } from './raster.js'

const DEMO_W = 1080
const DEMO_H = 1920

let canvas = null
let ctx = null

function ensureCanvas() {
  if (!canvas) {
    canvas = createCanvas(DEMO_W, DEMO_H)
    ctx = canvas.getContext('2d')
  }
}

const FONT = '"Segoe UI", "Microsoft YaHei", sans-serif'

function roundRect(x, y, w, h, r, fill) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
}

export async function renderDemoFrame() {
  ensureCanvas()
  const now = new Date()
  const t = Date.now() / 1000
  const time = now.toLocaleTimeString('zh-CN', { hour12: false })
  const dotX = 120 + ((t * 120) % 840)
  const dotY = 1230 + Math.sin(t * 2) * 60

  const bg = ctx.createLinearGradient(0, 0, 0, DEMO_H)
  bg.addColorStop(0, '#101A2E')
  bg.addColorStop(1, '#080D18')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, DEMO_W, DEMO_H)

  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#6E7C96'
  ctx.font = `38px ${FONT}`
  ctx.fillText('演示模式 · 未连接真机', 72, 120)
  ctx.fillStyle = '#F4F7FF'
  ctx.font = `700 82px ${FONT}`
  ctx.fillText(time, 72, 220)

  const hero = ctx.createLinearGradient(72, 300, 1008, 550)
  hero.addColorStop(0, '#FF8A3D')
  hero.addColorStop(1, '#FF5A1F')
  roundRect(72, 300, 936, 250, 36, hero)
  ctx.fillStyle = '#FFFFFF'
  ctx.font = `700 44px ${FONT}`
  ctx.fillText('主按钮 #FF6B2C', 128, 390)
  ctx.fillStyle = '#FFE7D8'
  ctx.font = `30px ${FONT}`
  ctx.fillText('点击这里可以测试找色与取坐标', 128, 456)
  roundRect(128, 486, 200, 46, 23, 'rgba(255,255,255,0.9)')

  roundRect(72, 600, 456, 300, 32, '#12B5A5')
  ctx.fillStyle = '#FFFFFF'
  ctx.font = `700 38px ${FONT}`
  ctx.fillText('青绿 #12B5A5', 116, 700)
  roundRect(116, 740, 180, 120, 24, 'rgba(255,255,255,0.16)')

  roundRect(552, 600, 456, 300, 32, '#7C5CFF')
  ctx.fillStyle = '#FFFFFF'
  ctx.font = `700 38px ${FONT}`
  ctx.fillText('紫罗兰 #7C5CFF', 596, 700)
  ctx.beginPath()
  ctx.arc(680, 800, 54, 0, Math.PI * 2)
  ctx.fillStyle = '#FF3B30'
  ctx.fill()
  ctx.fillStyle = '#FFFFFF'
  ctx.font = `700 34px ${FONT}`
  ctx.fillText('红', 660, 816)

  roundRect(72, 950, 936, 240, 32, '#18233B')
  ctx.fillStyle = '#9DB0D0'
  ctx.font = `32px ${FONT}`
  ctx.fillText('彩色图标区（找色测试）', 116, 1030)
  const dots = ['#F5C518', '#31C48D', '#E0245E', '#3B82F6', '#F97316']
  dots.forEach((color, i) => {
    ctx.beginPath()
    ctx.arc(180 + i * 180, 1110, 46, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
  })

  ctx.beginPath()
  ctx.arc(dotX, dotY, 26, 0, Math.PI * 2)
  ctx.fillStyle = '#FF3B30'
  ctx.fill()
  ctx.fillStyle = '#FF6B5E'
  ctx.font = `26px ${FONT}`
  ctx.fillText('动态红点 #FF3B30', dotX + 40, dotY + 12)

  for (let i = 0; i < 7; i += 1) {
    const h = 60 + Math.abs(Math.sin(t * 1.6 + i)) * 180
    roundRect(180 + i * 100, 1420 - h, 56, h, 14, `rgba(76,124,243,${(0.45 + i * 0.07).toFixed(2)})`)
  }

  ctx.fillStyle = '#6E7C96'
  ctx.font = `28px ${FONT}`
  ctx.fillText(`模拟分辨率 ${DEMO_W} × ${DEMO_H} · 画面持续刷新以验证实时投屏`, 72, 1520)

  roundRect(72, 1620, 936, 200, 28, '#0E1729')
  ctx.strokeStyle = '#233452'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.fillStyle = '#8FA2C0'
  ctx.font = `30px ${FONT}`
  ctx.fillText('操作提示', 116, 1700)
  ctx.fillStyle = '#5E7091'
  ctx.font = `28px ${FONT}`
  ctx.fillText('框选区域 → 复制 [x, y, w, h]    ·    点击像素 → 复制锚点颜色', 116, 1760)

  return canvasToBytes(canvas)
}

export const DEMO_SERIAL = 'demo'
export const DEMO_SCREEN = { width: DEMO_W, height: DEMO_H }
