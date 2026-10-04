// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeTitle, renderWithApp } from './test-utils';

const importPreview = vi.fn();
const importCommit = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  api: {
    importPreview: (...a: unknown[]) => importPreview(...a),
    importCommit: (...a: unknown[]) => importCommit(...a),
  },
}));

const { ImportFlow, IMPORT_CHUNK, notImportedCsv } = await import('./ImportFlow');

afterEach(() => {
  cleanup();
  importPreview.mockReset();
  importCommit.mockReset();
});

const CSV = [
  'Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date',
  ...Array.from(
    { length: IMPORT_CHUNK + 3 },
    (_, i) => `2024-01-02,Film ${i},1994,https://boxd.it/${i},4,,,2024-01-01`,
  ),
].join('\n');

const preview = {
  counts: {
    total: IMPORT_CHUNK + 3,
    matched: IMPORT_CHUNK + 1,
    duplicate: 0,
    notInStubbed: 2,
    invalid: 0,
  },
  sample: [
    { ref: 'diary:1', title: makeTitle(), watchedOn: '2024-01-01', rating10: 8, season: null },
  ],
  unmatched: [
    { ref: 'diary:2', title: 'Film, "2"', year: 1994, reason: 'not_in_stubbed' as const },
  ],
};
const ok = {
  created: { stubs: 1, reviews: 0 },
  skipped: { duplicate: 0, notInStubbed: 0, invalid: 0, existingReview: 0 },
};

async function upload(text: string, name = 'diary.csv') {
  const file = new File([text], name, { type: 'text/csv' });
  await act(async () => {
    fireEvent.change(screen.getByTestId('import-file'), { target: { files: [file] } });
  });
}

describe('ImportFlow (ADR-013 C-11)', () => {
  it('parses on device, previews without review bodies, commits in chunks and summarises', async () => {
    importPreview.mockResolvedValue(preview);
    importCommit.mockResolvedValue(ok);
    renderWithApp(<ImportFlow handle="maya" />);
    expect(screen.getByText(/Your file stays on this device/)).toBeTruthy();
    expect(screen.getByText('beta')).toBeTruthy();
    await upload(CSV);
    expect(await screen.findByTestId('import-preview')).toBeTruthy();
    const sent = importPreview.mock.calls[0]![0] as {
      source: string;
      rows: Record<string, unknown>[];
    };
    expect(sent.source).toBe('letterboxd');
    expect(sent.rows.every((r) => !('review' in r))).toBe(true);
    expect(screen.getByTestId('import-count-matched').textContent).toBe(String(IMPORT_CHUNK + 1));
    fireEvent.click(screen.getByTestId('import-opt-reviews'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: `Import ${IMPORT_CHUNK + 1}` }));
    });
    expect(await screen.findByTestId('import-summary')).toBeTruthy();
    expect(importCommit).toHaveBeenCalledTimes(2);
    const [a, b] = importCommit.mock.calls.map(
      (c) =>
        c[0] as {
          importId: string;
          final: boolean;
          rows: unknown[];
          options: { reviews: boolean };
        },
    );
    expect(a!.rows).toHaveLength(IMPORT_CHUNK);
    expect([a!.final, b!.final]).toEqual([false, true]);
    expect(a!.importId).toBe(b!.importId);
    expect(a!.options.reviews).toBe(false);
    expect(screen.getByTestId('import-summary').textContent).toContain(
      '2 stubs and 0 reviews added',
    );
    expect(screen.getByTestId('import-diary-link').getAttribute('href')).toBe('/u/maya?tab=diary');
  });

  it('shows the parser message for an unknown file and never calls the server', async () => {
    renderWithApp(<ImportFlow handle="maya" />);
    await upload('foo,bar\n1,2');
    expect((await screen.findByRole('alert')).textContent).toMatch(/couldn't recognise/);
    expect(importPreview).not.toHaveBeenCalled();
  });

  it('builds the not-imported CSV with escaping and the brand', () => {
    const csv = notImportedCsv(
      { source: 'letterboxd', label: 'x', rows: [], skipped: [] },
      preview,
    );
    expect(csv).toBe('Title,Year,Reason\r\n"Film, ""2""",1994,not in Stubbed\r\n');
  });
});
