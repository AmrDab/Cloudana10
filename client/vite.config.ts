import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 7003,
    host: true
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "../shared"),
    },
  },
  define: {
    global: 'globalThis',
  },
  optimizeDeps: {
    exclude: ['@phosphor-icons/webcomponents', '@phosphor-icons/webcomponents/*']
  },
  build: {
    rollupOptions: {
      external: [/^@phosphor-icons\/webcomponents/]
    }
  }
})