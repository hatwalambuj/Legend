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
});
