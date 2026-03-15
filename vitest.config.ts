import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [cloudflareTest({
    wrangler: { configPath: './wrangler.toml' },
    miniflare: {
      d1Databases: ['DB'],
      compatibilityDate: '2024-09-23',
      vars: {
        JWT_SECRET: 'vitest-test-secret-minimum-32-chars-ok',
        ENVIRONMENT: 'preview',
        ALLOWED_ORIGIN: 'http://localhost:5173',
      },
    },
  })],
  test: {
    globals: true,
  },
})
