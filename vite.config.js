import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  build: {
    rollupOptions: {
      input: {
        main: resolve(process.cwd(), 'index.html'),
        overlay: resolve(process.cwd(), 'overlay.html'),
        benchmark: resolve(process.cwd(), 'benchmark.html'),
        alphabet: resolve(process.cwd(), 'alphabet.html'),
        phone: resolve(process.cwd(), 'phone.html'),
        phoneScene: resolve(process.cwd(), 'phone-scene.html'),
      },
    },
  },
});
