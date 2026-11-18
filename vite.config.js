import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import { adbHelperPlugin } from './server/index.js'
import { indexEntryPlugin, TEMPLATE } from './build/index-entry.js'

export default defineConfig(({ command }) => ({
  /**
   * 打包产物要能丢到任意静态目录（子路径 / 本地静态服务器 / 仓库根目录）里直接打开，
   * 所以资源一律走相对路径。用 '/' 时 index.html 会去站点根找 /assets/xxx.js，
   * 放在 https://host/tools/autojs6/ 下面就整页 404。
   *
   * 开发服务器仍用 '/'：Vite 的 HMR / 中间件都按根路径组织，改相对路径只会自找麻烦。
   */
  base: command === 'build' ? './' : '/',
  plugins: [
    vue(),
    /**
     * Element Plus 按需引入：模板里写 <el-button> 就只打包 button 的 JS + CSS。
     * dirs 置空是有意的 —— 本项目的组件都是在父组件里显式 import 的，
     * 不需要再按目录自动注册，免得同一个组件被注册两次。
     */
    Components({
      dts: false,
      dirs: [],
      resolvers: [ElementPlusResolver()],
    }),
    adbHelperPlugin(),
    indexEntryPlugin(),
  ],
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
  },
  build: {
    /**
     * 入口用 index.dev.html 而不是 index.html：
     * 根 index.html 留给打包产物（`npm run build` 会把它同步成发布入口），
     * 开发模板单独一份，免得 build 一次就把 dev 入口顶掉、下次 dev 打不开。
     */
    rollupOptions: { input: TEMPLATE },
    // USB 直连这条链路本身就跑在 WebUSB / WebCodecs 上，最低已经是 Chrome 89+，
    // 不必为更老的语法环境降级，产物能小一圈
    target: 'es2020',
    // 按需引入后主包应该在 400KB 上下，留一点余量，超过就说明又被打回整包了
    chunkSizeWarningLimit: 700,
  },
}))
