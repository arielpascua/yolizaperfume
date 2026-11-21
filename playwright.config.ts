import { tmpdir } from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  webServer: {
    command: `npm run build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      // Hermetic: ambient values must not change the run. No database; orders land in a temp folder.
      DATABASE_URL: '',
      LOCAL_STORE_DIR: path.join(tmpdir(), 'yoliza-e2e'),
      // The e2e server is a production build, where the file store needs this explicit opt-in.
      ALLOW_LOCAL_STORE: '1',
      CHECKOUT_TEST_ITEM: '',
      // Invoice mode, always: the e2e run must never be able to start a real card payment.
      PAYMENT_PROVIDERS: '',
      HEXACORP_APP_UUID: '',
      HEXACORP_USERNAME: '',
      HEXACORP_SECRET: '',
      HEXACORP_WEBHOOK_SECRET: '',
      CHECKOUT_RATE_LIMIT_PER_MIN: '1000',
      CHECKOUT_IP_ORDERS_PER_10MIN: '1000',
      CHECKOUT_ORDERS_PER_10MIN: '1000',
      ENQUIRY_RATE_LIMIT_PER_MIN: '1000',
    },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
    { name: 'mobile-360', use: { ...devices['Pixel 5'], viewport: { width: 360, height: 740 } } },
  ],
});
