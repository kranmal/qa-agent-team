import { defineConfig } from 'vitest/config';

// White-box tests live in tests/unit and import code straight from the app (../src by default).
// Adjust `include` below to the folders that hold the app's source.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    reporters: ['default', ['json', { outputFile: 'artifacts/vitest.json' }]],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: 'artifacts/unit-coverage',
      allowExternal: true,
      include: ['../src/**/*.{ts,tsx,js,jsx}'],
      exclude: ['**/*.d.ts', '**/*.test.*', '**/*.spec.*'],
      // Raise these as coverage improves; they stop it from silently dropping.
      thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
    },
  },
});
