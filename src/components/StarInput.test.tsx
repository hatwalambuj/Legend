// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { StarInput } from './StarInput';

afterEach(cleanup);

function Harness({ start = 0 }: { start?: number }) {
  const [v, setV] = useState(start);
  return (
    <>
      <StarInput value={v} onChange={setV} />
      <output data-testid="v">{v}</output>
    </>
  );
}

describe('StarInput (half stars, radiogroup)', () => {
  it('has 10 radios and one tab stop', () => {
    render(<Harness />);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(10);
    expect(radios.filter((r) => r.tabIndex === 0)).toHaveLength(1);
    expect(screen.getByRole('radiogroup', { name: /half stars allowed/ })).toBeTruthy();
  });

  it('clicking a half target sets rating10, arrow keys step by half a star', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('radio', { name: '3.5 stars' }));
    expect(screen.getByTestId('v').textContent).toBe('7');
    expect(screen.getByRole('radio', { name: '3.5 stars' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    const group = screen.getByRole('radiogroup');
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(screen.getByTestId('v').textContent).toBe('8');
    fireEvent.keyDown(group, { key: 'ArrowLeft' });
    fireEvent.keyDown(group, { key: 'ArrowLeft' });
    expect(screen.getByTestId('v').textContent).toBe('6');
    fireEvent.keyDown(group, { key: 'End' });
    expect(screen.getByTestId('v').textContent).toBe('10');
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(screen.getByTestId('v').textContent).toBe('10');
    expect(screen.getByText('5/5')).toBeTruthy();
  });
});
