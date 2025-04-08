import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';

/** @type {import('eslint').Linter.Config} */
const config = {
  files: ['**/*.{js,jsx,ts,tsx}'],
  plugins: {
    '@next/next': nextPlugin
  },
  extends: [
    'eslint:recommended',
    'plugin:@next/next/recommended'
  ],
  rules: {
    '@next/next/no-html-link-for-pages': 'off',
    'react/jsx-key': 'off'
  }
};

export default [
  js.configs.recommended,
  config
];
