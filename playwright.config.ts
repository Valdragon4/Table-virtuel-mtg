import { defineConfig, devices } from '@playwright/test';

/**
 * Les tests E2E tapent une pile réellement démarrée : Postgres, le serveur et le
 * client construit. Voir e2e/README.md pour la préparation (base jetable et
 * quelques cartes ingérées suffisent).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
});
