import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { adbHelperPlugin } from './server/index.js'

export default defineConfig(({ command }) => ({
  /**
   * 打包产物要能丢到任意静态目录（子路径 / 本地静态服务器 / U 盘）里直接打开，
   * 所以资源一律走相对路径。用 '/' 时 index.html 会去站点根找 /assets/xxx.js，
   * 放在 https://host/tools/autojs6/ 下面就整页 404。
   *
   * 开发服务器仍用 '/'：Vite 的 HMR / 中间件都按根路径组织，改相对路径只会自找麻烦。
   */
  base: command === 'build' ? './' : '/',
  plugins: [vue(), adbHelperPlugin()],
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
  },
  build: {
    // USB 直连这条链路本身就跑在 WebUSB / WebCodecs 上，最低已经是 Chrome 89+，
    // 不必为更老的语法环境降级，产物能小一圈
    target: 'es2020',
    // 主包主要是 Element Plus 全量组件（gzip 后 ~430KB），本地工具不用卡这个警告
    chunkSizeWarningLimit: 1500,
  },
}))
