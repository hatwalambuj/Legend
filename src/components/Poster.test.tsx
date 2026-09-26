// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AppContext, DEFAULT_MODE } from '@/hooks/useApp';
import { Poster } from './Poster';
import { appValue } from './test-utils';

afterEach(cleanup);

describe('Poster fallback (ADR-007)', () => {
  it('swaps to the generated poster when the image fails', () => {
    const { container, getByText } = render(
      <AppContext.Provider value={appValue({ mode: { ...DEFAULT_MODE, images: 'tmdb' } })}>
        <Poster title="Arrival" posterPath="/x.jpg" palette={null} genreIds={[878]} />
      </AppContext.Provider>,
    );
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('https://image.tmdb.org/t/p/w342/x.jpg');
    fireEvent.error(img!);
    expect(container.querySelector('img')).toBeNull();
    expect(getByText('Arrival')).toBeTruthy();
    // genre default tint for Sci-Fi paints the background
    expect((container.firstChild as HTMLElement).style.backgroundColor).not.toBe('');
  });
});
