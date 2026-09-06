import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // Retain existing build artifacts; the project never purges output directories.
    emptyOutDir: false,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three/webgpu', 'three/tsl'],
        },
      },
    },
  },
});
