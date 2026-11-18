import { createApp } from 'vue'
/**
 * Element Plus 按需引入：模板里的 <el-xxx> 由 unplugin-vue-components 按需加载
 * （见 vite.config.js 的 ElementPlusResolver），这里不再 `app.use(ElementPlus)`，
 * 也不再引 `element-plus/dist/index.css` 整包样式。
 *
 * 语言包改由 App.vue 里的 <el-config-provider :locale="zhCn"> 提供。
 */
import './styles/main.css'
// ElMessage / ElMessageBox 是函数式调用，解析器只覆盖模板里的组件，样式要自己引
import 'element-plus/es/components/message/style/css'
import 'element-plus/es/components/message-box/style/css'
import App from './App.vue'
import { registerIcons } from './icons'

const app = createApp(App)

// 图标同样按需：只注册模板与动态组件真正用到的那些
registerIcons(app)

app.mount('#app')
