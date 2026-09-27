// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MODE } from '@/hooks/useApp';
import { WatchRegionSelect, WatchRegionSetting } from './WatchRegionSelect';
import { renderWithApp } from './test-utils';

const setWatchRegion = vi.fn();
vi.mock('@/lib/api-client', () => ({
  api: { setWatchRegion: (...a: unknown[]) => setWatchRegion(...a) },
}));

const mode = {
  ...DEFAULT_MODE,
  watchRegions: [
    { code: 'US', name: 'United States' },
    { code: 'GB', name: 'United Kingdom' },
  ],
};

beforeEach(() => setWatchRegion.mockReset());
afterEach(cleanup);

describe('WatchRegionSelect (DESIGN §7.4.2 Region)', () => {
  it('shows the code as text and names the native select', () => {
    const onChange = vi.fn();
    renderWithApp(
      <WatchRegionSelect
        value="GB"
        name="United Kingdom"
        options={mode.watchRegions}
        onChange={onChange}
      />,
      { mode },
    );
    const pill = screen.getByTestId('wtw-region');
    expect(pill.textContent).toContain('GB');
    const select = screen.getByRole('combobox', { name: 'Region: United Kingdom. Change region' });
    fireEvent.change(select, { target: { value: 'US' } });
    expect(onChange).toHaveBeenCalledWith('US');
  });
});

describe('WatchRegionSetting (Settings, W3-AC3)', () => {
  it('saves a region and Automatic (null)', async () => {
    setWatchRegion.mockResolvedValueOnce({ region: 'GB' }).mockResolvedValueOnce({ region: null });
    renderWithApp(<WatchRegionSetting initial={null} />, { mode });
    const select = screen.getByLabelText('Where to watch region') as HTMLSelectElement;
    expect(select.value).toBe('');
    await act(async () => {
      fireEvent.change(select, { target: { value: 'GB' } });
    });
    expect(setWatchRegion).toHaveBeenLastCalledWith('GB');
    expect(select.value).toBe('GB');
    expect(screen.getByText('Saved. Showing services in United Kingdom.')).toBeTruthy();
    await act(async () => {
      fireEvent.change(select, { target: { value: '' } });
    });
    expect(setWatchRegion).toHaveBeenLastCalledWith(null);
    expect(screen.getByText('Saved. We pick your region automatically.')).toBeTruthy();
  });

  it('reverts and toasts when saving fails', async () => {
    setWatchRegion.mockRejectedValueOnce(new Error('offline'));
    const { value } = renderWithApp(<WatchRegionSetting initial="US" />, { mode });
    const select = screen.getByLabelText('Where to watch region') as HTMLSelectElement;
    await act(async () => {
      fireEvent.change(select, { target: { value: 'GB' } });
    });
    expect(select.value).toBe('US');
    expect(value.toast).toHaveBeenCalled();
  });
});
