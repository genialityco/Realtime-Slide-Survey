import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { host: true },
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: { manualChunks: { firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'] } },
    },
  },
});
