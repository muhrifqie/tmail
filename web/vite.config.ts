import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3100',
      '/health': 'http://127.0.0.1:3100',
      '/internal': 'http://127.0.0.1:3100',
    },
  },
});
