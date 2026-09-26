import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      '@renderer': fileURLToPath(new URL('./src/renderer/src', import.meta.url))
    }
  },
  test: {
    include: ['tests/**/*.test.ts'],
    // Fixture generation shells out to ImageMagick and the metadata tests read
    // real files, so give them room on slower machines.
    testTimeout: 60_000,
    hookTimeout: 120_000
  }
})
