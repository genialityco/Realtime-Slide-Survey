import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const target = process.env.API_URL || 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      '/api': target,
      '/media': target,
      '/socket.io': { target, ws: true },
    },
  },
});
