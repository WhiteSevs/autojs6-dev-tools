/**
 * 入口页插件：把「开发入口」和「发布入口」分开。
 *
 * 根目录的 index.html 是**打包产物**（`npm run build` 自动生成，仓库根目录本身就能当静态站点托管），
 * 真正的模板是 index.dev.html：
 *
 *   - dev：把 `/` 与 `/index.html` 重写到 index.dev.html，浏览器地址仍是 http://127.0.0.1:5174/
 *   - build：以 index.dev.html 为入口，产物里先还原成 dist/index.html（preview 用），
 *            再同步一份到根 index.html（资源路径改指 ./dist/assets/…）。
 *
 * 这样「构建一次 → 根目录 index.html 就是发布入口」和「改代码用 dev 实时预览」互不打扰，
 * 也不会出现「build 把开发模板覆盖掉、下次 dev 打不开」的坑。
 */
import fs from 'node:fs/promises'
import path from 'node:path'

/** 开发入口模板（相对项目根） */
export const TEMPLATE = 'index.dev.html'

const BANNER = '<!-- 本文件由 npm run build 自动生成，请勿手改；开发入口是 index.dev.html -->'

/** 根 index.html 与打包产物不在同一层，资源路径要指到 ./dist/assets/ */
function toRootPaths(html) {
  return html.replace(/((?:src|href)=")\.\/assets\//g, '$1./dist/assets/')
}

export function indexEntryPlugin() {
  let root = process.cwd()

  return {
    name: 'autojs6-index-entry',

    configResolved(config) {
      root = config.root
    },

    /** dev：`/` 交给 index.dev.html，避免根 index.html（产物）把开发入口顶掉 */
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url || '/'
        const q = url.indexOf('?')
        const pathname = q === -1 ? url : url.slice(0, q)
        if (pathname === '/' || pathname === '/index.html') {
          req.url = `/${TEMPLATE}${q === -1 ? '' : url.slice(q)}`
        }
        next()
      })
    },

    /** build：产物入口同步到 dist/index.html（preview）与根 index.html（部署入口） */
    async closeBundle() {
      const outDir = path.resolve(root, 'dist')
      const built = path.join(outDir, TEMPLATE)
      let html
      try {
        html = await fs.readFile(built, 'utf8')
      } catch {
        // 没走 html 入口（例如只构建了库）就什么都不做
        return
      }

      const withBanner = html.replace(/^<!DOCTYPE html>/i, (tag) => `${tag}\n${BANNER}`)
      await fs.writeFile(path.join(outDir, 'index.html'), html, 'utf8')
      await fs.writeFile(path.join(root, 'index.html'), toRootPaths(withBanner), 'utf8')
      // 产物里保留 index.html 就够了，模板名那份不用留在 dist
      await fs.rm(built, { force: true })
    },
  }
}
