import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        // 本地 dev：/api 代理到 wrangler pages dev (8788)，避免 404；可被 VITE_API_PROXY 覆盖
        proxy: {
          '/api': {
            target: env.VITE_API_PROXY || 'http://localhost:8788',
            changeOrigin: true,
          },
        },
      },
      plugins: [react()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
