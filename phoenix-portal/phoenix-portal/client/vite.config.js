import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    /* Emit one stylesheet for the whole app instead of one per route chunk.
       The page CSS files are not self-contained — e.g. .alarm-tab lives in
       Alarms.css but Tickets, Calls, TechNotes, Admin, Projects and Inventory
       all use it. With per-chunk CSS those pages render unstyled until some
       other route happens to pull the file in. This is also what shipped before
       the routes were code-split, and it's ~27KB (~6KB gzipped) for the lot. */
    cssCodeSplit: false,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
})
