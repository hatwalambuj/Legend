import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const AI_PACKAGE =
  /^(openai|ai|@anthropic-ai\/|@ai-sdk\/|@google\/(generative-ai|genai)|langchain|@langchain\/|cohere-ai|@mistralai\/|ollama|replicate|@huggingface\/|llamaindex)/;

function files(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(ts|tsx|mts|mjs|yml)$/.test(f)) out.push(p);
  }
  return out;
}

describe('founder constraints', () => {
  it('ships no AI/LLM dependency (PRD D15)', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(deps.filter((d) => AI_PACKAGE.test(d))).toEqual([]);
  });

  // e2e/** is excluded on purpose: QA asserts the *absence* of these hooks there (PRD D3-AC1).
  it('has no third-party posting code paths left (ADR-008)', () => {
    const banned =
      /imdb-shared|imdbShared|imdb_shared|setImdbShared|trakt|sync_jobs|sync_accounts|imdb-assist/i;
    const hits = [...files('src'), ...files('scripts'), ...files('.github')].filter((f) =>
      banned.test(readFileSync(f, 'utf8')),
    );
    expect(hits).toEqual([]);
  });

  // ADR-013 §0 / C-09 / C-13: analytics and error tracking are first-party only.
  it('ships no third-party analytics or error-tracking vendor in src/ (ADR-013)', () => {
    const vendor =
      /sentry|posthog|plausible|googletagmanager|google-analytics|gtag\(|@segment\/|segment\.(io|com)|mixpanel/i;
    const hits = files('src').filter((f) => vendor.test(readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });

  // ADR-013 C-11: import files are parsed in the browser and never leave the device.
  it('the import parsers make no network call and import no server code', () => {
    const dir = join('src', 'lib', 'import');
    const hits = files(dir)
      .filter((f) => !f.endsWith('.test.ts'))
      .filter((f) =>
        /\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|from '@\/server|from "@\/server|next\/server/.test(
          readFileSync(f, 'utf8'),
        ),
      );
    expect(hits).toEqual([]);
  });

  // ADR-013 C-15a (after the FE sweep C-15b): user-visible copy reads BRAND_NAME (src/lib/brand.ts).
  // Comments and identifiers (mostStubbed, notInStubbed) are fine; tests and test helpers are allowlisted.
  it('has no "Stubbed" string literal in src/app or src/components (C-15)', () => {
    const strip = (src: string) =>
      src
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
    const hits = [...files(join('src', 'app')), ...files(join('src', 'components'))]
      .filter((f) => !/\.test\.tsx?$|test-utils\.tsx$/.test(f))
      .flatMap((f) =>
        strip(readFileSync(f, 'utf8'))
          .split('\n')
          .filter((l) => /\bStubbed\b/.test(l))
          .map((l) => `${f}: ${l.trim()}`),
      );
    expect(hits).toEqual([]);
  });
});
