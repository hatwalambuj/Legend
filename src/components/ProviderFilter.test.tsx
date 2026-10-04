// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ProviderFilter } from './ProviderFilter';
import { renderWithApp } from './test-utils';

afterEach(cleanup);

const chips = [
  { providerId: 8, name: 'Netflix', logoPath: null, monogram: 'N', count: 12 },
  { providerId: 9, name: 'Prime Video', logoPath: null, monogram: 'P', count: 0 },
];

describe('ProviderFilter (ADR-013 C-02)', () => {
  it('renders "On {name}" links that keep type/sort and drop zero-count chips', () => {
    renderWithApp(
      <ProviderFilter base="/browse" type="movie" sort="rating_desc" provider={8} chips={chips} />,
    );
    const on = screen.getByRole('link', { name: 'On Netflix' });
    expect(on.getAttribute('href')).toBe('/browse?type=movie&sort=rating_desc&provider=8');
    expect(on.getAttribute('aria-current')).toBe('true');
    expect(screen.queryByTestId('provider-chip-9')).toBeNull();
    const all = screen.getByTestId('provider-chip-all');
    expect(all.getAttribute('href')).toBe('/browse?type=movie&sort=rating_desc');
    expect(all.getAttribute('aria-current')).toBeNull();
  });

  it('hides the row when no chip has titles', () => {
    renderWithApp(
      <ProviderFilter
        base="/browse"
        type="all"
        sort="release_desc"
        provider={null}
        chips={[chips[1]!]}
      />,
    );
    expect(screen.queryByTestId('provider-filter')).toBeNull();
  });
});
