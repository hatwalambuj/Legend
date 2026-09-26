// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
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
