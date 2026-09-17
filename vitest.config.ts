import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/**/test/**/*.test.ts', 'packages/**/test/**/*.test.ts'],
    environment: 'node',
    // Les tests d'intégration base de données sont isolés derrière ce tag et ne
    // tournent que si DATABASE_URL pointe sur une base jetable.
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
