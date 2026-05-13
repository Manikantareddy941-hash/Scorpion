import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    basicSsl()
  ],
  assetsInclude: ['**/*.jpg', '**/*.jpeg', '**/*.png', '**/*.webp'],
  build: {
    assetsInlineLimit: 0, // never inline images as base64
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  server: {
    https: true,
    port: 5173,
    watch: {
      ignored: ['**/backend/tmp/**', '**/tmp/**']
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
