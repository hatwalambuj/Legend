// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StubDetailsForm } from './StubSheet';
import { renderWithApp } from './test-utils';

afterEach(cleanup);

describe('StubDetailsForm (C2, GAP-09)', () => {
  it('tells the user that notes are public, linked to the note field', () => {
    renderWithApp(
      <StubDetailsForm
        target={{ key: 'movie:1', mediaType: 'movie', tmdbId: 1, title: 'Anora', year: 2024 }}
        submitLabel="Stub it"
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
        headingId="h"
        heading="Stub with details"
      />,
    );
    const note = screen.getByLabelText(/Note/);
    const hint = screen.getByText('Notes show on your public diary.');
    expect(note.getAttribute('aria-describedby')).toContain(hint.id);
  });
});

describe('Season picker (ADR-013 C-10)', () => {
  const show = { key: 'tv:1' as const, mediaType: 'tv' as const, tmdbId: 1, title: 'Severance', year: 2022 };
  const props = {
    submitLabel: 'Stub it',
    onCancel: vi.fn(),
    headingId: 'h',
    heading: 'Stub with details',
  };

  it('offers Whole show + S01..S{n} for a show and submits the pick', () => {
    const onSubmit = vi.fn();
    renderWithApp(<StubDetailsForm {...props} target={{ ...show, seasonCount: 3 }} onSubmit={onSubmit} />);
    const select = screen.getByTestId('stub-season') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(['Whole show', 'S01', 'S02', 'S03']);
    fireEvent.change(select, { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: /Stub it/ }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ season: 2 }));
  });

  it('is hidden for movies and when seasonCount is unknown', () => {
    renderWithApp(<StubDetailsForm {...props} target={{ ...show, seasonCount: null }} onSubmit={vi.fn()} />);
    expect(screen.queryByTestId('stub-season')).toBeNull();
    cleanup();
    renderWithApp(
      <StubDetailsForm
        {...props}
        target={{ key: 'movie:1', mediaType: 'movie', tmdbId: 1, title: 'Anora', year: 2024, seasonCount: 3 }}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('stub-season')).toBeNull();
  });
});
