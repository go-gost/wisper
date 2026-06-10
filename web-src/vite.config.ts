import { defineConfig } from 'vite';

export default defineConfig({
  // Serve from root so that relative paths work when embedded in the Go binary.
  base: '/',
  build: {
    // Output to the Go-embedded web/ directory.
    outDir: '../web',
    emptyOutDir: true,
    // Minimize output size for embedding (esbuild, no extra deps).
    minify: 'esbuild',
    target: 'es2020',
    rollupOptions: {
      output: {
        // Single JS and CSS bundles for minimal file count.
        manualChunks: undefined,
      },
    },
  },
  server: {
    port: 3000,
    // Proxy /api/* to the Go backend during development.
    proxy: {
      '/api': 'http://127.0.0.1:8900',
    },
  },
});
