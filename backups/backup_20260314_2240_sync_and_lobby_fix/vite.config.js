import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // Ensure relative paths for Electron
  build: {
    outDir: 'dist'
  }
});
