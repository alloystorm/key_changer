import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // './' keeps asset paths relative — works for Capacitor (file://),
  // Tauri (custom protocol), and GitHub Pages (subdirectory hosting)
  base: './',
  optimizeDeps: {
    include: ['tone', 'soundfont-player', '@tonejs/midi', 'jszip', 'opensheetmusicdisplay'],
  },
})
