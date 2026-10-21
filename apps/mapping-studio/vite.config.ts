import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: { chunkSizeWarningLimit: 2000 },
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
});
