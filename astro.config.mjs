import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
// Site is served at the root of the custom domain lehrenlieben.de.
// When moving to Vercel later: add `@astrojs/vercel` back as `adapter: vercel()`.
export default defineConfig({
  site: 'https://lehrenlieben.de',
  integrations: [react()],
  output: 'static',
  vite: {
    plugins: [tailwindcss()],
  },
});
