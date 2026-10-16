import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { legendFor } from '../../src/domain/pins';
import { defaultSettings } from '../../src/model';
import type { MapPrefs } from '../../src/model';
import { newUnit } from '../../src/model/factories';
import { LayersPanel } from '../../src/ui/map/LayersPanel';
import type { MapPrefsChange } from '../../src/ui/map/LayersPanel';
import { Legend } from '../../src/ui/map/Legend';

/** M3: the Map layers panel (DESIGN.md §4.7) and the legend. */

function setup(prefs: MapPrefs = defaultSettings().map) {
  const changes: { next: MapPrefs; label: string }[] = [];
  const onChange = (change: MapPrefsChange, label: string) =>
    changes.push({ next: change(prefs), label });
  const onClose = vi.fn();
  render(<LayersPanel prefs={prefs} onChange={onChange} onClose={onClose} />);
  return { changes, onClose };
}

const group = (name: string) => screen.getByRole('group', { name });

describe('LayersPanel', () => {
  it('shows the five base maps with Wayfinding chosen', () => {
    setup();
    const bases = within(group('Base map')).getAllByRole('button');
    expect(bases.map((b) => b.querySelector('[class*="bn"]')?.textContent)).toEqual([
      'Wayfinding',
      'Detailed streets',
      'OpenStreetMap',
      'Cycle map',
      'Aerial photo',
    ]);
    expect(bases[0]).toHaveAttribute('aria-pressed', 'true');
  });

  it('disables options that are not ready yet and falls back to rent', () => {
    setup();
    const pins = group('Pins show');
    expect(within(pins).getByRole('button', { name: /Total cost/ })).toBeDisabled();
    expect(within(pins).getByRole('button', { name: /Cost per ft²/ })).toBeDisabled();
    expect(within(pins).getByRole('button', { name: /Travel time/ })).toBeDisabled();
    // The default ("total") shows as rent until M8
    expect(within(pins).getByRole('button', { name: 'Rent' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('reports each change with a readable label', async () => {
    const user = userEvent.setup();
    const { changes } = setup();
    await user.click(screen.getByRole('button', { name: /Aerial photo/ }));
    await user.click(within(group('Pins show')).getByRole('button', { name: 'Beds and size' }));
    await user.click(screen.getByRole('checkbox', { name: 'Star rating' }));
    await user.click(within(group('Pin color')).getByRole('button', { name: 'Label' }));
    await user.click(screen.getByRole('checkbox', { name: 'Fade rejected units' }));
    expect(changes.map((c) => c.label)).toEqual([
      'Base map: Aerial photo',
      'Pins show: Beds and size',
      'Pins: star rating on',
      'Pin color: Label',
      'Fade rejected units off',
    ]);
    expect(changes[0]?.next.baseLayer).toBe('aerial');
    expect(changes[1]?.next.pins.show).toBe('beds');
    expect(changes[2]?.next.pins.extras.stars).toBe(true);
    expect(changes[3]?.next.pins.colorBy).toBe('label');
    expect(changes[4]?.next.pins.fadeRejected).toBe(false);
  });

  it('shows Phase 2 overlays disabled and closes from its button', async () => {
    const user = userEvent.setup();
    const { onClose } = setup();
    const overlays = within(group('Overlays Phase 2')).getAllByRole('checkbox');
    expect(overlays).toHaveLength(7);
    for (const o of overlays) expect(o).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Close map layers' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('starts with the extras DESIGN.md lists: New badge on, the others off', () => {
    setup();
    expect(screen.getByRole('checkbox', { name: 'Unit type icon' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Star rating' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'New badge' })).toBeChecked();
  });
});

describe('Legend', () => {
  it('names each status color on the map', () => {
    const units = [newUnit({ buildingId: 'b', status: 'toured' }), newUnit({ buildingId: 'b' })];
    render(<Legend legend={legendFor(units, 'status', defaultSettings().labelNames)} />);
    const legend = screen.getByRole('region', { name: 'Pin color: status' });
    expect(
      within(legend)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['New', 'Toured']);
  });

  it('gives the rent range for price colors', () => {
    const units = [
      newUnit({ buildingId: 'b', rent: 1200 }),
      newUnit({ buildingId: 'b', rent: 2400 }),
    ];
    render(<Legend legend={legendFor(units, 'price', defaultSettings().labelNames)} />);
    expect(screen.getByRole('region', { name: 'Pin color: rent' })).toHaveTextContent(
      'Lightest $1,200to darkest $2,400',
    );
  });
});
