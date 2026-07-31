import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: [
        'src/cloud/**/*.ts', 'src/diagnostics.ts', 'src/domain/**/*.ts',
        'src/emulator/audio-output.ts', 'src/emulator/input.ts', 'src/settings.ts',
        'src/storage/**/*.ts',
      ],
      exclude: ['src/**/*.test.ts'],
    },
  },
})
