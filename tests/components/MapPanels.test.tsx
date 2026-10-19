import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { legendFor } from '../../src/domain/pins';
import { defaultMapMemory } from '../../src/domain/pinPrefs';
import type { BaseLayer, PinPrefs, PinView } from '../../src/domain/pinPrefs';
import { defaultSettings } from '../../src/model';
import type { Unit } from '../../src/model';
import { newUnit } from '../../src/model/factories';
import { LayersPanel } from '../../src/ui/map/LayersPanel';
import { Legend } from '../../src/ui/map/Legend';
import { PinsPanel } from '../../src/ui/map/PinsPanel';

/** M3 review: the Pins panel, the Map layers panel with base-map keys, and the legend. */

const group = (name: string) => screen.getByRole('group', { name });

function PinsHarness({ view = 'units' as PinView, log }: { view?: PinView; log: PinPrefs[] }) {
  const [prefs, setPrefs] = useState(defaultMapMemory().pins);
  return (
    <PinsPanel
      view={view}
      prefsFor={prefs}
      onChange={(v, p) => {
        log.push(p);
        setPrefs({ ...prefs, [v]: p });
      }}
      onClose={() => {}}
      legend={null}
    />
  );
}

describe('PinsPanel', () => {
  it('greys out text fields for dots and brings them back for plates', async () => {
    const user = userEvent.setup();
    render(<PinsHarness log={[]} />);
    const rent = screen.getByRole('checkbox', { name: 'Rent' });
    expect(rent).toBeChecked();
    await user.click(within(group('Pin style')).getByRole('button', { name: 'Dot' }));
    expect(rent).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Beds and size' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /Range/ })).toBeDisabled();
    await user.click(within(group('Pin style')).getByRole('button', { name: 'Photo' }));
    expect(rent).toBeEnabled();
    expect(rent).toBeChecked();
  });

  it('combines fields and keeps pending ones disabled', async () => {
    const user = userEvent.setup();
    const log: PinPrefs[] = [];
    render(<PinsHarness log={log} />);
    await user.click(screen.getByRole('checkbox', { name: 'Your rating' }));
    await user.click(screen.getByRole('checkbox', { name: 'Unit type icon' }));
    expect(log.at(-1)?.fields).toEqual(['type', 'rent', 'rating']);
    expect(screen.getByRole('checkbox', { name: /Total cost/ })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /Cost per ft²/ })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /Travel time/ })).toBeDisabled();
  });

  it('changes the New badge, rejected units and crowding', async () => {
    const user = userEvent.setup();
    const log: PinPrefs[] = [];
    render(<PinsHarness log={log} />);
    expect(within(group('New units')).getByRole('button', { name: '“New” tag' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(within(group('New units')).getByRole('button', { name: 'Dot' }));
    await user.click(within(group('Rejected units')).getByRole('button', { name: 'Hide' }));
    await user.click(
      screen.getByRole('checkbox', { name: 'Group nearby buildings when zoomed out' }),
    );
    await user.click(screen.getByRole('radio', { name: /Lowest/ }));
    expect(log.at(-1)).toMatchObject({
      newBadge: 'dot',
      rejected: 'hide',
      bubbles: false,
      priceMode: 'lowest',
    });
  });

  it('edits the view the list shows, and says which', () => {
    render(<PinsHarness log={[]} />);
    expect(screen.getByText(/For the Units view/)).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', {
        name: 'Open buildings’ cards when zoomed in, where they fit',
      }),
    ).toBeChecked();
    expect(screen.queryByRole('group', { name: 'Settings for' })).toBeNull();
  });

  it('sizes pins with a slider, and resets it', async () => {
    const user = userEvent.setup();
    const log: PinPrefs[] = [];
    render(<PinsHarness log={log} />);
    const slider = screen.getByRole('slider', { name: 'Pin size' });
    expect(slider).toHaveValue('100');
    expect(screen.queryByRole('button', { name: 'Reset to 100%' })).toBeNull();
    fireEvent.change(slider, { target: { value: '80' } });
    expect(log.at(-1)?.size).toBe(80);
    expect(slider).toHaveAttribute('aria-valuetext', '80%');
    await user.click(screen.getByRole('button', { name: 'Reset to 100%' }));
    expect(log.at(-1)?.size).toBe(100);
  });

  it('in the Buildings view: building name, no automatic opening', async () => {
    const user = userEvent.setup();
    const log: PinPrefs[] = [];
    render(<PinsHarness view="buildings" log={log} />);
    expect(screen.getByText(/For the Buildings view/)).toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', {
        name: 'Open buildings’ cards when zoomed in, where they fit',
      }),
    ).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: 'Building name' }));
    expect(log.at(-1)?.fields).toEqual(['rent', 'unit']);
  });
});

describe('LayersPanel', () => {
  function LayersHarness() {
    const [base, setBase] = useState<BaseLayer>('wayfinding');
    const [sharper, setSharper] = useState(false);
    return (
      <LayersPanel
        base={base}
        onBase={setBase}
        sharper={sharper}
        onSharper={setSharper}
        onClose={() => {}}
      />
    );
  }

  it('shows the five base maps and a key for the chosen one', async () => {
    const user = userEvent.setup();
    render(<LayersHarness />);
    const bases = within(group('Base map')).getAllByRole('button');
    expect(bases.map((b) => b.querySelector('[class*="bn"]')?.textContent)).toEqual([
      'Wayfinding',
      'Detailed streets',
      'OpenStreetMap',
      'Cycle map',
      'Aerial photo',
    ]);
    expect(screen.getByRole('list', { name: 'Wayfinding colors' })).toHaveTextContent('Water');

    await user.click(screen.getByRole('button', { name: /Cycle map/ }));
    expect(screen.getByRole('link', { name: /CyclOSM legend/ })).toHaveAttribute(
      'href',
      'https://www.cyclosm.org/legend.html',
    );
    await user.click(screen.getByRole('button', { name: /^OpenStreetMap/ }));
    expect(screen.getByRole('link', { name: /roads, paths and rail/ })).toHaveAttribute(
      'href',
      'https://wiki.openstreetmap.org/wiki/OpenStreetMap_Carto/Lines',
    );
  });

  it('offers sharper tiles only for the raster street maps, off by default', async () => {
    const user = userEvent.setup();
    render(<LayersHarness />);
    const sharper = () =>
      screen.queryByRole('checkbox', { name: 'Sharper OpenStreetMap and Cycle maps' });
    expect(sharper()).toBeNull();
    await user.click(screen.getByRole('button', { name: /^OpenStreetMap/ }));
    expect(sharper()).not.toBeChecked();
    await user.click(sharper()!);
    expect(sharper()).toBeChecked();
    await user.click(screen.getByRole('button', { name: /Aerial photo/ }));
    expect(sharper()).toBeNull();
  });

  it('shows Phase 2 overlays disabled', () => {
    render(<LayersHarness />);
    const overlays = within(group('Overlays Phase 2')).getAllByRole('checkbox');
    expect(overlays).toHaveLength(7);
    for (const o of overlays) expect(o).toBeDisabled();
    // Pin options moved to their own panel
    expect(screen.queryByRole('group', { name: 'Pins show' })).toBeNull();
  });
});

const asRows = (units: Unit[]) =>
  units.map((unit) => ({
    unit,
    building: undefined,
    mine: { rating: 0 as const, flag: 'none' as const },
    cost: { total: unit.rent, perSqft: null },
  }));

describe('Legend', () => {
  it('names each status color on the map', () => {
    const units = [newUnit({ buildingId: 'b', status: 'toured' }), newUnit({ buildingId: 'b' })];
    render(<Legend legend={legendFor(asRows(units), 'status', defaultSettings().labelNames)} />);
    const legend = screen.getByRole('region', { name: 'Pin color: status' });
    expect(
      within(legend)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['New', 'Toured']);
  });

  it('gives the total cost range for price colors', () => {
    const units = [
      newUnit({ buildingId: 'b', rent: 1200 }),
      newUnit({ buildingId: 'b', rent: 2400 }),
    ];
    render(<Legend legend={legendFor(asRows(units), 'price', defaultSettings().labelNames)} />);
    expect(screen.getByRole('region', { name: 'Pin color: total cost' })).toHaveTextContent(
      'Lightest $1,200to darkest $2,400',
    );
  });
});
