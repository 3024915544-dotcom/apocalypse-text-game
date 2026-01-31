import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      // 不在前端注入任何 API Key；/api/turn 由 Cloudflare 后端调用 DeepSeek
      proxy: env.VITE_API_PROXY
        ? { "/api": { target: env.VITE_API_PROXY, changeOrigin: true } }
        : undefined,
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
