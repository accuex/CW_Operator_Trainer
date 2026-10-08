import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ['**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  // docs/ holds study-material prototypes and work notes; nothing there ships with the app.
  // lib/geography/engine/ must stay byte-identical to its docs/ source (geography.test.ts checks the digests).
  globalIgnores(['.next/**', 'out/**', 'build/**', 'dist/**', 'next-env.d.ts', 'docs/**', 'lib/geography/engine/**']),
]);

export default eslintConfig;
