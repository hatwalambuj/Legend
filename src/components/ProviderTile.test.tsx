// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_MODE } from '@/hooks/useApp';
import { ProviderMark, ProviderTile, providerTileName } from './ProviderTile';
import { Ticket } from './Ticket';
import { makeTitle, renderWithApp } from './test-utils';

afterEach(cleanup);

const netflix = {
  providerId: 8,
  name: 'Netflix',
  logoPath: '/netflix.png',
  monogram: 'N',
  tile: '#b20710',
  href: 'https://www.netflix.com/search?q=Dune',
  linkKind: 'search' as const,
};

describe('ProviderTile (W2, W5)', () => {
  it('names tiles per W5-AC1', () => {
    expect(providerTileName('Tubi', 'ads')).toBe('Open Tubi (free with ads) — opens in a new tab');
    expect(providerTileName('Apple TV', 'rent', true)).toBe(
      'Open Apple TV (rent · buy) — opens in a new tab',
    );
  });

  it('renders a w92 logo with alt="" in real mode and falls back to the monogram on error', () => {
    renderWithApp(<ProviderTile provider={netflix} type="stream" region="US" />, {
      mode: { ...DEFAULT_MODE, images: 'tmdb' },
    });
    const img = screen.getByTestId('wtw-provider-8').querySelector('img')!;
    expect(img.getAttribute('src')).toBe('https://image.tmdb.org/t/p/w92/netflix.png');
    expect(img.getAttribute('alt')).toBe('');
    expect(img.getAttribute('width')).toBe('44');
    fireEvent.error(img);
    expect(screen.getByTestId('wtw-provider-8').querySelector('img')).toBeNull();
    expect(screen.getByTestId('wtw-provider-8').textContent).toContain('N');
  });

  it('never requests image.tmdb.org when images are off', () => {
    renderWithApp(<ProviderTile provider={netflix} type="stream" region="US" />);
    expect(screen.getByTestId('wtw-provider-8').querySelector('img')).toBeNull();
  });
});

describe('Ticket stub provider hint (DESIGN §3.3, W7-AC1)', () => {
  it('replaces the serial with a decorative, non-link 16px mark and extends the link name', () => {
    renderWithApp(
      <Ticket title={makeTitle()} hint={{ providerId: 8, name: 'Netflix', logoPath: null }} />,
    );
    const mark = screen.getByTestId('ticket-providers');
    // ADR-013 C-01: decorative (the ticket link's name carries ", on Netflix"), never a link.
    expect(mark.getAttribute('aria-hidden')).toBe('true');
    expect(mark.querySelector('a')).toBeNull();
    expect(mark.closest('a')).toBeNull();
    expect(screen.queryByText('ADMIT ONE')).toBeNull();
    expect(
      screen.getByRole('link', {
        name: 'Dune: Part Two, movie, 2024, rated 8.2 on TMDB and 8.5 on IMDb, on Netflix',
      }),
    ).toBeTruthy();
  });

  it('reads title.watchHint from the list API and names the provider once (ADR-013 C-01)', () => {
    const watchHint = {
      providerId: 8,
      name: 'Netflix',
      logoPath: null,
      monogram: 'N',
      tile: '#b20710',
    };
    renderWithApp(<Ticket title={{ ...makeTitle(), watchHint }} />);
    expect(screen.getByTestId('ticket-providers').textContent).toBe('N');
    expect(
      screen.getByRole('link', {
        name: 'Dune: Part Two, movie, 2024, rated 8.2 on TMDB and 8.5 on IMDb, on Netflix',
      }),
    ).toBeTruthy();
  });

  it('is hidden without data and on the hero ticket', () => {
    renderWithApp(<Ticket title={makeTitle()} />);
    expect(screen.queryByTestId('ticket-providers')).toBeNull();
    cleanup();
    renderWithApp(
      <Ticket
        title={makeTitle()}
        variant="hero"
        hint={{ providerId: 8, name: 'Netflix', logoPath: null }}
      />,
    );
    expect(screen.queryByTestId('ticket-providers')).toBeNull();
  });

  it('standalone mark uses the monogram', () => {
    renderWithApp(<ProviderMark name="Netflix" logoPath={null} monogram="N" tile="#b20710" />);
    expect(screen.getByTestId('ticket-providers').textContent).toBe('N');
  });
});
