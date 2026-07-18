// UI-only dev server: runs the renderer in a plain browser with the mock
// platform (demo library, localStorage persistence). Used for rapid UI work
// and visual review without launching Electron.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  server: { port: 5199, strictPort: true },
  build: { outDir: resolve(__dirname, 'dist-web') }
})
