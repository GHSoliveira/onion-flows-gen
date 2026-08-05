import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          ui: ['lucide-react', 'react-hot-toast'],
          flow: ['reactflow']
        }
      }
    }
  },
  server: {
    // Allow Cloudflare quick tunnels (and similar reverse proxies) in local testing
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3101',
        changeOrigin: true,
        secure: false,
        configure: (proxy, _options) => {
          proxy.on('error', (err, _req, _res) => {
            console.log('❌ Proxy error:', err);
          });
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            console.log('🔄 Proxy request:', req.method, req.url, '→', proxyReq.getHeader('host'));
          });
          proxy.on('proxyRes', (proxyRes, req, _res) => {
            console.log('✅ Proxy response:', req.method, req.url, '→', proxyRes.statusCode);
          });
        }
      },
      '/socket.io': {
        target: 'http://localhost:3101',
        changeOrigin: true,
        ws: true,
        secure: false
      }
    },
    port: 3000,
    host: '0.0.0.0'
  }
})
