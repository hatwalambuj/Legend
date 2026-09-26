// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  NEUTRAL_PALETTE,
  paletteOrDefault,
  posterFallbackStyle,
  posterSrcSet,
  tmdbImage,
} from '@/lib/images';

describe('image helpers (ADR-007)', () => {
  it('builds TMDB URLs only when images are on', () => {
    expect(tmdbImage('/abc.jpg', 'w342', 'tmdb')).toBe('https://image.tmdb.org/t/p/w342/abc.jpg');
    expect(tmdbImage('/abc.jpg', 'w342', 'off')).toBeNull();
    expect(tmdbImage(null, 'w342', 'tmdb')).toBeNull();
    expect(posterSrcSet('/a.jpg', 'tmdb')).toContain('w185/a.jpg 185w');
  });
  it('falls back to genre tints, then neutral', () => {
    expect(paletteOrDefault(null, [878]).tint1).toBe('#1c2a4a');
    expect(paletteOrDefault(null, [])).toBe(NEUTRAL_PALETTE);
  });
  it('renders a generated poster style in the DOM (jsdom + React smoke test for component tests)', () => {
    render(<div data-testid="poster" style={posterFallbackStyle(NEUTRAL_PALETTE)} />);
    expect(screen.getByTestId('poster').style.backgroundImage).toContain('linear-gradient');
  });
});
