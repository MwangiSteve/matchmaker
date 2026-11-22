import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development, /api calls go to the Node API on port 3000.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:3000' } },
});
