import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Sportivos',
        short_name: 'Sportivos',
        description: 'Gestión de inventario, ventas y cartera',
        theme_color: '#103c35',
        background_color: '#f5f7f4',
        display: 'standalone',
        start_url: './',
        icons: [{ src: './icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
})
