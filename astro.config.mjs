import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
// When moving to Vercel later: add `@astrojs/vercel` back as `adapter: vercel()`
// and leave BASE_PATH unset so the site deploys at the root.
//
// BASE_PATH controls the subpath:
//   - GitHub Pages deploys via Actions with BASE_PATH="/lehren-lieben"
//   - Vercel / root deploys leave it empty
const basePath = process.env.BASE_PATH || '/';

export default defineConfig({
  site: process.env.SITE || 'https://tobiaskammer-de.github.io',
  base: basePath,
  integrations: [react()],
  output: 'static',
  vite: {
    plugins: [tailwindcss()],
  },
});
