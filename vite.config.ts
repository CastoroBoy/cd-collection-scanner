import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  base: './', // valido sia nel sottopercorso GitHub Pages sia in locale
  build: { target: 'es2022', sourcemap: false },
  test: { environment: 'node', include: ['src/tests/**/*.test.ts'] }
});
