import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { addListing, createBuilding, createUnit } from '../../src/commands/records';
import { db } from '../../src/db/db';
import { makeAddress } from '../../src/model/factories';
import { routes } from '../../src/routes';
import { readPhoton } from '../../src/services/geocode/photon';
import type { Place } from '../../src/services/geocode';
import type * as GeocodeModule from '../../src/services/geocode';
import { resetUi, useUi } from '../../src/state/ui';

/** M4: Quick-add, paste text, duplicates and Place on map, with the geocoders faked. */

const geo = vi.hoisted(() => ({
  suggest: vi.fn<(q: string) => Promise<Place[]>>(),
  lookup: vi.fn<(q: string) => Promise<Place | null>>(),
}));
vi.mock('../../src/services/geocode', async (importOriginal) => {
  const real = await importOriginal<typeof GeocodeModule>();
  return { ...real, geocoder: () => geo };
});

const photon = readPhoton(
  JSON.parse(
    readFileSync(resolve(__dirname, '../fixtures/geocode/photon-riverlight.json'), 'utf8'),
  ) as unknown,
);
const fixture = (name: string) =>
  readFileSync(resolve(__dirname, '../fixtures/listing-text', name), 'utf8');

let router: ReturnType<typeof createMemoryRouter>;
const renderAt = (path = '/') => {
  router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(<RouterProvider router={router} />);
};
const path = () => router.state.location.pathname;
const dialog = () => screen.getByRole('dialog', { name: 'Add a unit' });
const field = (name: string) => within(dialog()).getByLabelText(name, { exact: true });

let ids: { cedar: string; u702: string };

beforeEach(async () => {
  localStorage.clear();
  resetUi();
  await db.delete();
  await db.open();
  geo.suggest.mockReset().mockResolvedValue(photon);
  geo.lookup.mockReset().mockResolvedValue(null);
  const cedar = await createBuilding(db, {
    name: 'Cedar Mill',
    address: makeAddress('1800 Cedar Lake Rd', 'St. Louis Park', 'MN', '55416'),
    location: { lat: 44.97, lng: -93.33, source: 'photon', precision: 'address' },
  });
  const u702 = await createUnit(db, {
    buildingId: cedar.id,
    unitNumber: '702',
    rent: 2560,
    bedrooms: 3,
  });
  await addListing(db, {
    unitId: u702.id,
    site: 'building-site',
    url: 'https://cedarmill.example.com/702',
    firstSeen: '2026-10-01',
    observations: [{ date: '2026-10-01', rent: 2560, note: null }],
  });
  ids = { cedar: cedar.id, u702: u702.id };
});

describe('quick-add', () => {
  it('opens with N or the Add button, and Esc closes it', async () => {
    const user = userEvent.setup();
    renderAt();
    await screen.findByText(/1 unit in 1 building/);
    await user.keyboard('n');
    expect(path()).toBe('/add');
    expect(dialog()).toBeVisible();
    expect(field('Listing link')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(path()).toBe('/');
    await user.click(screen.getByRole('button', { name: /Add unit/ }));
    expect(path()).toBe('/add');
  });

  it('adds a unit at a suggested address: new building, location and first price', async () => {
    const user = userEvent.setup();
    renderAt('/add');
    await screen.findByRole('dialog', { name: 'Add a unit' });
    await user.type(field('Address'), 'Riverl');
    const option = await screen.findByRole('option', { name: /Riverlight 201 South Example/ });
    await user.click(option);
    expect(within(dialog()).getByText(/New building in Downtown East/)).toBeVisible();
    await user.type(field('Unit'), '1504');
    await user.type(field('Rent'), '1650');
    await user.type(field('Beds'), '1');
    await user.type(field('Baths'), '1');
    await user.click(within(dialog()).getByRole('button', { name: 'Add and open' }));

    await waitFor(() => expect(path()).toMatch(/^\/unit\//));
    const unit = (await db.units.toArray()).find((u) => u.unitNumber === '1504');
    expect(unit).toMatchObject({ rent: 1650, bedrooms: 1, bathrooms: 1, addedVia: 'quick-add' });
    const b = await db.buildings.get(unit!.buildingId);
    expect(b).toMatchObject({
      name: 'Riverlight',
      location: { lat: 44.9801, lng: -93.2601, source: 'photon' },
      neighborhood: { name: 'Downtown East' },
    });
    expect(await db.listings.where('unitId').equals(unit!.id).toArray()).toMatchObject([
      { url: null, site: 'other', observations: [{ rent: 1650 }] },
    ]);
    expect(useUi.getState().notice?.text).toBe('Unit 1504 at Riverlight added.');
    expect(geo.lookup).not.toHaveBeenCalled();
  });

  it('suggests your own buildings first and shows the duplicate banner', async () => {
    const user = userEvent.setup();
    renderAt('/add');
    await screen.findByRole('dialog', { name: 'Add a unit' });
    await user.type(field('Address'), 'Cedar');
    await user.click(await screen.findByRole('option', { name: /^Cedar Mill In your list/ }));
    expect(within(dialog()).getByText(/Cedar Mill is in your list; adding it there/)).toBeVisible();
    await user.type(field('Unit'), '702');
    expect(
      within(dialog()).getByText(/This looks like Unit 702 at Cedar Mill, added/),
    ).toBeVisible();
    await user.type(field('Rent'), '2495{Enter}');

    await waitFor(() => expect(path()).toBe('/'));
    expect(await db.units.count()).toBe(1); // no duplicate
    expect((await db.units.get(ids.u702))?.rent).toBe(2495);
    const [l] = await db.listings.toArray();
    expect(l?.observations.map((o) => o.rent)).toEqual([2560, 2495]);
  });

  it('"Add as a separate unit" adds a new unit anyway', async () => {
    const user = userEvent.setup();
    renderAt(`/add?building=${ids.cedar}`);
    await screen.findByRole('dialog', { name: 'Add a unit' });
    expect(field('Unit')).toHaveFocus();
    await user.type(field('Unit'), '702');
    await user.click(within(dialog()).getByRole('button', { name: 'Add as a separate unit' }));
    await user.click(within(dialog()).getByRole('button', { name: /^Add unit/ }));
    await waitFor(() => expect(path()).toBe('/'));
    expect(await db.units.count()).toBe(2);
  });

  it('recognizes a link already saved', async () => {
    const user = userEvent.setup();
    renderAt('/add');
    await screen.findByRole('dialog', { name: 'Add a unit' });
    await user.type(field('Listing link'), 'cedarmill.example.com/702/');
    expect(within(dialog()).getByText('Site: Building website')).toBeVisible();
    expect(
      within(dialog()).getByText('This link is already saved for Unit 702 at Cedar Mill.'),
    ).toBeVisible();
  });

  it('fills the boxes from a Zillow link and pasted text, and applies the chips you keep', async () => {
    const user = userEvent.setup();
    renderAt('/add');
    await screen.findByRole('dialog', { name: 'Add a unit' });
    await user.type(
      field('Listing link'),
      'https://www.zillow.com/homedetails/1234-Example-Ave-S-APT-1504-Minneapolis-MN-55401/1_zpid/',
    );
    expect(field('Address')).toHaveValue('1234 Example Ave S, Minneapolis, MN 55401');
    expect(field('Unit')).toHaveValue('1504');

    // Pasting goes through the textarea as one change.
    await user.click(field('Paste listing text (optional)'));
    await user.paste(fixture('zillow-unit.txt'));
    expect(field('Rent')).toHaveValue('1650');
    expect(field('Beds')).toHaveValue('1');
    const chips = within(dialog()).getByRole('list', { name: 'Recognized details' });
    const pool = within(chips).getByRole('button', { name: /Fitness center/ });
    expect(pool).toHaveAttribute('aria-pressed', 'true');
    await user.click(pool); // leave it out
    expect(pool).toHaveAttribute('aria-pressed', 'false');

    geo.lookup.mockResolvedValue(null); // not found: saved without a location
    await user.click(within(dialog()).getByRole('button', { name: /^Add unit/ }));
    await waitFor(() => expect(path()).toBe('/'));

    const unit = (await db.units.toArray()).find((u) => u.unitNumber === '1504')!;
    expect(unit).toMatchObject({
      rent: 1650,
      squareFeet: 720,
      laundry: 'in-unit',
      utilities: { heat: { mode: 'included' } },
    });
    const b = await db.buildings.get(unit.buildingId);
    expect(b?.location).toBeNull();
    expect(b?.address.line1).toBe('1234 Example Ave S');
    expect(b?.amenities.fitness).toBeNull(); // left out
    expect(b?.amenities.skywayConnected).toBe(true);
    expect(await db.imports.count()).toBe(1);
    expect(unit.fieldSources.find((s) => s.field === 'unit.rent')).toMatchObject({ via: 'paste' });
    expect(useUi.getState().notice?.text).toMatch(/isn’t on the map yet/);
    expect(geo.lookup).toHaveBeenCalledWith('1234 Example Ave S, Minneapolis, MN 55401');
  });

  it('⇧⏎ adds and starts another unit in the same building', async () => {
    const user = userEvent.setup();
    renderAt(`/add?building=${ids.cedar}`);
    await screen.findByRole('dialog', { name: 'Add a unit' });
    await user.type(field('Unit'), '101');
    await user.type(field('Rent'), '1800{Shift>}{Enter}{/Shift}');
    expect(
      await within(dialog()).findByText(
        /Unit 101 at Cedar Mill added\. Add the next unit at Cedar Mill\./,
      ),
    ).toBeVisible();
    expect(field('Unit')).toHaveValue('');
    expect(field('Unit')).toHaveFocus();
    await user.type(field('Unit'), '102{Enter}');
    await waitFor(() => expect(path()).toBe('/'));
    const numbers = (await db.units.toArray()).map((u) => u.unitNumber).sort();
    expect(numbers).toEqual(['101', '102', '702']);
    expect(new Set((await db.units.toArray()).map((u) => u.buildingId)).size).toBe(1);
  });

  it('asks for an address and explains bad numbers', async () => {
    const user = userEvent.setup();
    renderAt('/add');
    await screen.findByRole('dialog', { name: 'Add a unit' });
    await user.click(within(dialog()).getByRole('button', { name: /^Add unit/ }));
    expect(within(dialog()).getByRole('alert')).toHaveTextContent(
      'Enter an address, or pick a building from your list.',
    );
    expect(field('Address')).toHaveFocus();
    await user.type(field('Address'), '1 Main St');
    await user.type(field('Beds'), 'two');
    await user.click(within(dialog()).getByRole('button', { name: /^Add unit/ }));
    expect(within(dialog()).getByRole('alert')).toHaveTextContent(/Beds should be a number/);
    expect(await db.units.count()).toBe(1);
  });
});

describe('a unit you already have', () => {
  it('pastes more listing text: new details on, changes off, one undo step', async () => {
    const user = userEvent.setup();
    renderAt(`/unit/${ids.u702}`);
    await user.click(await screen.findByRole('button', { name: 'Paste text' }));
    await user.paste('$2,495/mo\n3 bd\nDishwasher\nNo dogs');
    const chips = screen.getByRole('list', { name: 'Recognized details' });
    // 3 bd matches what you have: not shown
    expect(within(chips).queryByRole('button', { name: /3 bd/ })).toBeNull();
    const rent = within(chips).getByRole('button', { name: /\$2,495\/mo \(yours: \$2,560\)/ });
    expect(rent).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: 'Apply 2' }));
    await waitFor(async () => expect((await db.units.get(ids.u702))?.dishwasher).toBe(true));
    expect((await db.units.get(ids.u702))?.rent).toBe(2560);
    expect((await db.buildings.get(ids.cedar))?.pets.dogs).toBe(false);
  });

  it('places a building without a location on the map', async () => {
    const user = userEvent.setup();
    const b = await createBuilding(db, { address: makeAddress('5 Elm St', 'Minneapolis') });
    const u = await createUnit(db, { buildingId: b.id, unitNumber: '1' });
    renderAt(`/unit/${u.id}`);
    const button = await screen.findByRole('button', { name: 'Place on map' });
    await user.click(button);
    expect(useUi.getState().placing).toEqual({ buildingId: b.id, name: '5 Elm St' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    await user.keyboard('{Escape}');
    expect(useUi.getState().placing).toBeNull();
    expect(path()).toBe(`/unit/${u.id}`); // Esc cancelled placing first
    act(() => useUi.getState().setPlacing(null));
  });
});
