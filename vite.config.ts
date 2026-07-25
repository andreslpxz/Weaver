import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Tauri expects a fixed port; if not available, error out
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: 'ws', host, port: 1421 }
      : undefined,
    watch: {
      // don't watch the rust source
      ignored: ['**/src-tauri/**'],
    },
    // Proxy para Ollama: evita problemas de CORS cuando Weaver corre en
    // el navegador (localhost:1420) y Ollama en localhost:11434.
    // Las requests a /ollama-api/* se redirigen a http://localhost:11434/*
    proxy: {
      '/ollama-api': {
        target: 'http://localhost:11434',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ollama-api/, ''),
      },
    },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    target:
      process.env.TAURI_ENV_PLATFORM === 'windows'
        ? 'chrome105'
        : 'safari13',
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    // Code-splitting: separa vendor chunks para reducir el bundle principal.
    // Monaco y react-syntax-highlighter son los más pesados.
    rollupOptions: {
      output: {
        manualChunks: {
          // React core
          'react-vendor': ['react', 'react-dom'],
          // Monaco editor (~5MB sin split)
          'monaco': ['monaco-editor', '@monaco-editor/react'],
          // Markdown + syntax highlighting
          'markdown': [
            'react-markdown',
            'remark-gfm',
            'rehype-raw',
            'react-syntax-highlighter',
          ],
          // State + routing
          'state': ['zustand', 'clsx', 'tailwind-merge'],
          // Tauri SDK
          'tauri': [
            '@tauri-apps/api',
            '@tauri-apps/plugin-dialog',
            '@tauri-apps/plugin-shell',
            '@tauri-apps/plugin-store',
          ],
          // Icons
          'icons': ['lucide-react'],
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
});
