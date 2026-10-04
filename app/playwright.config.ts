import { defineConfig } from '@playwright/test'

const packaged = /packaged\.spec\.ts/

export default defineConfig({
  testDir: 'e2e',
  reporter: process.env.CI ? 'github' : 'list',
  projects: [
    { name: 'dev', testIgnore: packaged },
    ...(process.env.MARU_PACKAGED_APP ? [{ name: 'packaged', testMatch: packaged }] : [])
  ]
})
