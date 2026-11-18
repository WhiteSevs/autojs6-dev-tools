# AGENTS.md

面向在本仓库里干活的 AI / 协作者的项目约定。改动前先读一遍，能省掉不少来回。

## 技术栈与结构

- **Vite + Vue 3 + Element Plus**，纯前端单页应用。
- 两条连接引擎，互不相干：
  - `ADB 命令`：`server/` 以 Vite 插件形式提供 `/api/*` 与 `/ws/screen`，调用本机 `adb`；
  - `USB 直连`：`src/backend/local/` 在浏览器里用 WebUSB + Tango 直接和 adbd 通信，不经过 Node。
- 前端对设备的调用统一从 `src/api.js`（即 `src/backend/index.js` 的门面）进出，按当前引擎分发。
  组件不要直接 `fetch('/api/...')`，否则 USB 直连模式下会失效。

## 规则

### 1. Element Plus 必须按需引入

- 模板里直接写 `<el-button>` / `<el-dialog>` 即可，由 `unplugin-vue-components` 的
  `ElementPlusResolver` 自动引入组件与样式（配置在 `vite.config.js`）。
- **不要**在 `src/main.js` 里 `app.use(ElementPlus)`，也**不要** `import 'element-plus/dist/index.css'`。
  这两句会把整包打回来（实测主包 542KB → 1.33MB、CSS 149KB → 401KB）。
- 函数式组件（`ElMessage` / `ElMessageBox` / `ElNotification` / `ElLoading`）解析器管不到样式，
  用到时在 `src/main.js` 手动引对应的 `element-plus/es/components/<name>/style/css`
  （目前已有 message、message-box）。新增这类 API 记得补样式，否则弹出来是裸的。
- 语言包由 `App.vue` 里的 `<el-config-provider :locale="zhCn">` 提供，不要改回 `app.use`。
- 图标在 `src/icons.js` 里按需注册。模板里新增图标要**同时**加进 import 与 `icons` 映射；
  用 `<component :is="'Xxx'" />` 这种动态写法的图标也必须在 `src/icons.js` 里，否则运行时会找不到组件。

### 2. 打包入口与产物

- 开发/构建模板是 `index.dev.html`；`npm run dev` 时 `/` 会被重写到它（见 `build/index-entry.js`）。
- 根 `index.html` 是**打包产物**（自动生成、勿手改），资源指向 `./dist/assets/…`。
- `dist/` 纳入版本库，方便直接从仓库根目录部署（GitHub Pages：`main` / 根目录）。
  改完代码要 `npm run build`，并把 `dist/` 与根 `index.html` 一起提交。
- `vite.config.js` 里 `base` 在 build 时是 `'./'`，不要改成 `'/'`，否则子路径部署会 404。

### 3. 代码风格

- 注释写「为什么」，不写「是什么」；面向中文用户，UI 文案、注释、提交信息都用中文。
- 提交信息沿用仓库现有的 emoji + Conventional Commits 风格，例如
  `✨ feat: …` / `🐛 fix: …` / `💄 style: …` / `🔧 chore: …`。
- 不要自行修改 `pnpm-lock.yaml` / `package-lock.json` 里与本次改动无关的内容。

## 常用命令

```bash
npm run dev       # 开发（含 ADB 命令引擎）
npm run build     # 构建 dist/ 并同步根 index.html
npm run preview   # 预览 dist/
```
