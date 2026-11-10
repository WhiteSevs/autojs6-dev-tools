import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { adbHelperPlugin } from './server/index.js'

export default defineConfig({
  plugins: [vue(), adbHelperPlugin()],
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
  },
})
