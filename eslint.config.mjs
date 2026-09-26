import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier/flat';

// PRD D15 / BRIEF: the app and its jobs run with NO AI/LLM access. Importing an AI SDK is a lint error.
const noAiSdks = {
  group: [
    'openai',
    'openai/*',
    '@anthropic-ai/*',
    'ai',
    '@ai-sdk/*',
    '@google/generative-ai',
    '@google/genai',
    'langchain',
    'langchain/*',
    '@langchain/*',
    'cohere-ai',
    '@mistralai/*',
    'ollama',
    'replicate',
    '@huggingface/*',
    'llamaindex',
  ],
  message: 'No AI/LLM anywhere (PRD D15). Build it from stored data, rules and templates.',
};

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'Never render HTML from data (review text is user input). See ADR-004.',
        },
      ],
      'no-restricted-imports': ['error', { patterns: [noAiSdks] }],
    },
  },
  {
    // Client code must never import server-only modules (secrets, DB, fs).
    files: ['src/components/**/*.{ts,tsx}', 'src/hooks/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            noAiSdks,
            {
              group: ['@/server/*', '@/server/**'],
              message:
                'Components must not import server modules. Pages (RSC) call @/server/dal and pass props down. See WORK_SPLIT.md.',
            },
          ],
        },
      ],
    },
  },
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    '.data/**',
    'coverage/**',
    'playwright-report/**',
    'test-results/**',
    'docs/**',
  ]),
]);
