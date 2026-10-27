import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
  },
  test: {
    environment: 'node',
    testTimeout: 120_000,
    hookTimeout: 120_000,
    include: ['tests/**/*.test.{ts,tsx}'],
  },
})
