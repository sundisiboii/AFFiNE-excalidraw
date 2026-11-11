import { fileURLToPath } from 'node:url';

import baseConfig from './playwright.config';

// Exercise the production bundle on a dedicated port, independently of dev apps.
export default {
  ...baseConfig,
  testMatch: 'excalidraw.spec.ts',
  use: { ...baseConfig.use, baseURL: 'http://127.0.0.1:18080/' },
  webServer: {
    command: 'node tests/affine-local/serve-production.mjs',
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    url: 'http://127.0.0.1:18080/',
    reuseExistingServer: false,
    timeout: 30000,
  },
};
