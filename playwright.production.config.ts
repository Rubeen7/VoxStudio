import { defineConfig } from '@playwright/test'
import config from './playwright.config'

// Exercise the full user flow against the bundled app, including the emitted worklet URL.
export default defineConfig(config, {
  grep: /import, edit/,
  use: { baseURL: 'http://127.0.0.1:4173' },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
})
