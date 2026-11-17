import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => {
    return {
      server: {
        port: 3000,
        host: '127.0.0.1',
        proxy: {
          '/canvas-api': {
            target: 'https://usflearn.instructure.com',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/canvas-api/, ''),
            // Research build is read-only against Canvas: non-GET requests get 404, never forwarded.
            bypass: (req) => (req.method === 'GET' || req.method === 'HEAD' ? undefined : false)
          },
          '/grading-api': {
            target: 'http://127.0.0.1:5557',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/grading-api/, '')
          }
        }
      },
      plugins: [react()],
      // Server-side keys must never be inlined into the client bundle.
      define: {
        'process.env.API_KEY': 'undefined',
        'process.env.GEMINI_API_KEY': 'undefined'
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
