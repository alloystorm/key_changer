import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // './' required for Capacitor (file://) and Tauri (custom protocol)
  base: './',
  optimizeDeps: {
    include: ['tone', 'soundfont-player', '@tonejs/midi', 'jszip', 'opensheetmusicdisplay'],
  },
})
