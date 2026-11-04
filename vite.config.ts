import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' : GitHub Pages(/Bang/)·Firebase Hosting·로컬 어디서든 같은 빌드로 동작 (관리자는 #/admin)
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5173 },
});
