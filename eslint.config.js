import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/', 'dist/', 'coverage/', '.tmp/', 'test-data/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Tests navigate untyped raw fixtures and mutate them on purpose.
    files: ['**/*.test.ts', '**/test/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
