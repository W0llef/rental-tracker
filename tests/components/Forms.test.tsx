import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { addListing, createBuilding, createUnit, updateSettings } from '../../src/commands/records';
import { undo } from '../../src/commands/undo';
import { db } from '../../src/db/db';
import { ensureMe } from '../../src/db/me';
import { makeAddress } from '../../src/model/factories';
import { routes } from '../../src/routes';
import { resetUi } from '../../src/state/ui';

/** M8: the full unit and building forms, essentials and Edit together for buildings. */

let router: ReturnType<typeof createMemoryRouter>;
const renderAt = (path: string) => {
  router = createMemoryRouter(routes, { initialEntries: ['/', path], initialIndex: 1 });
  return render(<RouterProvider router={router} />);
};
const path = () => router.state.location.pathname;

let ids: { riverlight: string; larkin: string; u1504: string; plan: string; listing: string };

async function seed() {
  await ensureMe(db);
  const riverlight = await createBuilding(db, {
    name: 'Riverlight',
    address: makeAddress('200 Portland Ave S', 'Minneapolis', 'MN', '55401'),
    floors: 24,
  });
  const larkin = await createBuilding(db, {
    name: 'The Larkin',
    address: makeAddress('1010 Nicollet Mall', 'Minneapolis', 'MN', '55403'),
  });
  const u1504 = await createUnit(db, {
    buildingId: riverlight.id,
    unitNumber: '1504',
    bedrooms: 1,
    rent: 1650,
  });
  const plan = await createUnit(db, {
    buildingId: riverlight.id,
    isFloorPlanOnly: true,
    floorPlanName: 'Plan C',
    bedrooms: 2,
    bathrooms: 2,
    laundry: 'in-unit',
    utilities: {
      heat: { mode: 'included' },
      electric: null,
      waterSewer: null,
      trash: null,
      gas: null,
      internet: null,
    },
  });
  await createUnit(db, { buildingId: larkin.id, unitNumber: '310', rent: 1295 });
  const l = await addListing(db, {
    unitId: u1504.id,
    site: 'zillow',
    url: 'https://www.zillow.com/homedetails/example',
    firstSeen: '2026-10-01',
    observations: [{ date: '2026-10-01', rent: 1650, note: null }],
  });
  ids = {
    riverlight: riverlight.id,
    larkin: larkin.id,
    u1504: u1504.id,
    plan: plan.id,
    listing: l.id,
  };
}

beforeEach(async () => {
  localStorage.clear();
  resetUi();
  await db.delete();
  await db.open();
  await seed();
});

const row = (label: string) => {
  const el = screen
    .getAllByText(label, { selector: 'label, span' })
    .map((l) => l.closest('[data-field]'))
    .find(Boolean);
  if (!el) throw new Error(`No field row "${label}"`);
  return el as HTMLElement;
};

describe('unit form', () => {
  it('edits fields, marks unknowns and saves once, then goes back', async () => {
    const user = userEvent.setup();
    renderAt(`/unit/${ids.u1504}/edit`);
    const bathrooms = await screen.findByRole('textbox', { name: 'Bathrooms' });
    expect(row('Bathrooms')).toHaveAttribute('data-empty');
    await user.type(bathrooms, '1.5');
    expect(row('Bathrooms')).not.toHaveAttribute('data-empty');

    // Yes · No · ? on a yes/no field
    const dish = within(row('Dishwasher')).getByRole('radiogroup');
    await user.click(within(dish).getByRole('radio', { name: 'Yes' }));
    expect(within(dish).getByRole('radio', { name: 'Yes' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    // ? marks unknown: no longer counted as "not asked yet"
    await user.click(screen.getByRole('button', { name: 'Mark Balcony unknown' }));
    expect(row('Balcony')).toHaveAttribute('data-unknown');
    expect(row('Balcony')).not.toHaveAttribute('data-empty');

    // Utilities: Extra $ with an amount
    const heat = row('Heat');
    await user.click(within(heat).getByRole('radio', { name: 'Extra $' }));
    await user.type(within(heat).getByRole('textbox'), '40');

    // A typo blocks saving and says why
    await user.type(screen.getByRole('textbox', { name: 'Square feet' }), 'big');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter square feet');
    await user.click(screen.getByRole('button', { name: /^Save/ }));
    expect(await screen.findByText(/Fix one field first: Enter square feet/)).toBeVisible();
    expect((await db.units.get(ids.u1504))?.bathrooms).toBeNull();
    await user.clear(screen.getByRole('textbox', { name: 'Square feet' }));
    await user.type(screen.getByRole('textbox', { name: 'Square feet' }), '720');

    await user.click(screen.getByRole('button', { name: /^Save/ }));
    // Opened from a link (not from the app), so it goes to the unit's panel.
    await waitFor(() => expect(path()).toBe(`/unit/${ids.u1504}`));
    const saved = await db.units.get(ids.u1504);
    expect(saved).toMatchObject({
      bathrooms: 1.5,
      squareFeet: 720,
      dishwasher: true,
      balcony: null,
    });
    expect(saved?.utilities.heat).toEqual({ mode: 'extra', amount: 40 });

    // One undo step takes the whole save back
    await undo(db);
    const back = await db.units.get(ids.u1504);
    expect(back).toMatchObject({ bathrooms: null, squareFeet: null, dishwasher: null });
  });

  it('records a new rent in the price history', async () => {
    const user = userEvent.setup();
    renderAt(`/unit/${ids.u1504}/edit`);
    const rent = await screen.findByRole('textbox', { name: 'Rent' });
    await user.clear(rent);
    await user.type(rent, '1,600');
    expect(
      screen.getByText(/Saving records \$1,600 as today’s price on the Zillow listing/),
    ).toBeVisible();
    await user.keyboard('{Control>}s{/Control}');
    await waitFor(() => expect(path()).toBe(`/unit/${ids.u1504}`));
    const listing = await db.listings.get(ids.listing);
    expect(listing?.observations.map((o) => o.rent)).toEqual([1650, 1600]);
    expect((await db.units.get(ids.u1504))?.rent).toBe(1600);
  });

  it('asks before leaving with unsaved changes', async () => {
    const user = userEvent.setup();
    renderAt(`/unit/${ids.u1504}/edit`);
    await user.type(await screen.findByRole('textbox', { name: 'Flooring' }), 'Hardwood');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    const dialog = await screen.findByRole('dialog', { name: 'Leave without saving?' });
    await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    expect(path()).toBe(`/unit/${ids.u1504}/edit`);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Discard changes' }),
    );
    await waitFor(() => expect(path()).toBe(`/unit/${ids.u1504}`));
    expect((await db.units.get(ids.u1504))?.flooring).toBeNull();
  });

  it('copies details from a floor plan into what’s unknown', async () => {
    const user = userEvent.setup();
    renderAt(`/unit/${ids.u1504}/edit`);
    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Copy details from' }),
      'Plan C (floor plan)',
    );
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(
      screen.getByText(/Copied 3 details from Plan C; kept 1 you already had \(bedrooms\)/),
    ).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Bathrooms' })).toHaveValue('2');
    expect(screen.getByRole('textbox', { name: 'Bedrooms' })).toHaveValue('1');
  });

  it('makes a new unit from a floor plan', async () => {
    const user = userEvent.setup();
    renderAt(`/new-unit?from=${ids.plan}`);
    expect(await screen.findByRole('heading', { name: 'New unit at Riverlight' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Floor plan' })).toHaveValue('Plan C');
    expect(screen.getByRole('textbox', { name: 'Bedrooms' })).toHaveValue('2');
    await user.type(screen.getByRole('textbox', { name: 'Unit number' }), '1201');
    await user.click(screen.getByRole('button', { name: /^Add unit/ }));
    await waitFor(() => expect(path()).toMatch(/^\/unit\//));
    const id = path().split('/')[2]!;
    expect(await db.units.get(id)).toMatchObject({
      unitNumber: '1201',
      floorPlanName: 'Plan C',
      bedrooms: 2,
      laundry: 'in-unit',
      isFloorPlanOnly: false,
    });
  });

  it('opens at a field from a missing-essential prompt', async () => {
    renderAt(`/unit/${ids.u1504}/edit?field=unit.availableDate`);
    const date = await screen.findByLabelText('Available');
    await waitFor(() => expect(date).toHaveFocus());
  });

  it('shows completeness and essentials beside the form', async () => {
    renderAt(`/unit/${ids.u1504}/edit`);
    const summary = await screen.findByRole('complementary', { name: 'Summary' });
    expect(within(summary).getByText('Essentials 2 of 11')).toBeVisible();
    expect(within(summary).getByRole('list', { name: 'Missing essentials' })).toHaveTextContent(
      'Bathrooms',
    );
    expect(within(summary).getByText(/On the building: pet policy/)).toBeVisible();
  });
});

describe('unit panel', () => {
  it('lists missing essentials as prompts, and Ready to compare when there are none', async () => {
    renderAt(`/unit/${ids.u1504}`);
    const prompts = await screen.findByRole('list', { name: 'Missing essentials' });
    const rent = within(prompts).queryByRole('link', { name: 'Add rent' });
    expect(rent).toBeNull(); // known
    expect(within(prompts).getByRole('link', { name: 'Add bathrooms' })).toHaveAttribute(
      'href',
      `/unit/${ids.u1504}/edit?field=unit.bathrooms`,
    );
    expect(
      within(prompts).getByRole('link', { name: /^Add pet policy\s?\(building\)$/ }),
    ).toHaveAttribute(
      'href',
      `/building/${ids.riverlight}/edit?field=building.pets.cats&unit=${ids.u1504}`,
    );
    await updateSettings(db, (s) => ({ ...s, essentialFields: ['unit.rent', 'unit.bedrooms'] }));
    expect(await screen.findByText('Ready to compare')).toBeVisible();
  });

  it('E opens the form of the open unit', async () => {
    const user = userEvent.setup();
    renderAt(`/unit/${ids.u1504}`);
    await screen.findByRole('heading', { name: 'Unit 1504' });
    await user.keyboard('e');
    await waitFor(() => expect(path()).toBe(`/unit/${ids.u1504}/edit`));
  });
});

describe('building form and editing buildings together', () => {
  it('saves building facts in one step', async () => {
    const user = userEvent.setup();
    renderAt(`/building/${ids.riverlight}/edit`);
    await user.type(await screen.findByRole('textbox', { name: 'Year built' }), '2019');
    const pool = within(row('Pool')).getByRole('radiogroup');
    await user.click(within(pool).getByRole('radio', { name: 'Yes' }));
    const cats = within(row('Cats allowed')).getByRole('radiogroup');
    await user.click(within(cats).getByRole('radio', { name: 'No' }));
    await user.type(screen.getByRole('textbox', { name: 'Website' }), 'riverlight.example');
    await user.click(screen.getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(path()).toBe(`/building/${ids.riverlight}`));
    const b = await db.buildings.get(ids.riverlight);
    expect(b).toMatchObject({ yearBuilt: 2019, website: 'https://riverlight.example/' });
    expect(b?.amenities.pool).toBe(true);
    expect(b?.pets.cats).toBe(false);
  });

  it('selects buildings with ⌘/Ctrl-click and edits them together', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await user.click(await screen.findByRole('button', { name: 'Buildings' }));
    const cards = within(await screen.findByRole('list', { name: 'Buildings' })).getAllByRole(
      'link',
    );
    await user.keyboard('{Control>}');
    await user.click(cards[0]!);
    await user.click(cards[1]!);
    await user.keyboard('{/Control}');
    const bar = screen.getByRole('region', { name: 'Selected buildings' });
    expect(bar).toHaveTextContent('2 buildings selected');
    await user.click(within(bar).getByRole('button', { name: 'Edit together…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit 2 buildings together' });
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Fitness' }), 'Yes');
    await user.click(within(dialog).getByRole('button', { name: 'Apply to 2 buildings' }));
    await waitFor(async () =>
      expect((await db.buildings.get(ids.larkin))?.amenities.fitness).toBe(true),
    );
    expect((await db.buildings.get(ids.riverlight))?.amenities.fitness).toBe(true);
  });
});

describe('standalone homes, remembered unknowns and complex names (M8 review)', () => {
  async function seedHouse() {
    const house = await createBuilding(db, {
      address: makeAddress('3624 15th Ave S', 'Minneapolis', 'MN', '55407'),
      buildingType: 'house',
    });
    const unit = await createUnit(db, { buildingId: house.id, type: 'house', rent: 2260 });
    return { house, unit };
  }

  it('edits a standalone home’s own facts in its unit form, saved in one step', async () => {
    const user = userEvent.setup();
    const { house, unit } = await seedHouse();
    renderAt(`/unit/${unit.id}/edit`);
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('3624 15th Ave S');
    expect(
      screen.getByRole('checkbox', { name: 'Part of a larger building or complex' }),
    ).not.toBeChecked();
    expect(screen.queryByRole('combobox', { name: 'Building' })).toBeNull();
    await user.type(screen.getByRole('textbox', { name: 'Year built' }), '1915');
    await user.click(within(row('Cats allowed')).getByRole('radio', { name: 'Yes' }));
    await user.type(screen.getByRole('textbox', { name: 'Bedrooms' }), '3');
    await user.click(screen.getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(path()).toBe(`/unit/${unit.id}`));
    expect(await db.buildings.get(house.id)).toMatchObject({
      yearBuilt: 1915,
      pets: expect.objectContaining({ cats: true }),
    });
    expect((await db.units.get(unit.id))?.bedrooms).toBe(3);
    await undo(db); // one step takes back both
    expect((await db.buildings.get(house.id))?.yearBuilt).toBeNull();
    expect((await db.units.get(unit.id))?.bedrooms).toBeNull();
  });

  it('keeps standalone homes out of the Building menu, and can join one to a building', async () => {
    const user = userEvent.setup();
    const { house, unit } = await seedHouse();
    renderAt(`/unit/${ids.u1504}/edit`);
    const menu = await screen.findByRole('combobox', { name: 'Building' });
    const options = within(menu)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options.some((o) => o?.includes('3624 15th Ave S'))).toBe(false);
    expect(options.some((o) => o?.includes('Riverlight'))).toBe(true);

    cleanup();
    renderAt(`/unit/${unit.id}/edit`);
    await screen.findByRole('heading', { level: 1, name: '3624 15th Ave S' });
    await user.click(
      screen.getByRole('checkbox', { name: 'Part of a larger building or complex' }),
    );
    expect(screen.getByRole('combobox', { name: 'Building' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(path()).toBe(`/unit/${unit.id}`));
    expect((await db.buildings.get(house.id))?.standalone).toBe(false);
  });

  it('a standalone home’s panel sends building essentials to its unit form', async () => {
    const { unit } = await seedHouse();
    renderAt(`/unit/${unit.id}`);
    const prompts = await screen.findByRole('list', { name: 'Missing essentials' });
    expect(within(prompts).getByRole('link', { name: 'Add pet policy' })).toHaveAttribute(
      'href',
      `/unit/${unit.id}/edit?field=building.pets.cats`,
    );
    expect(screen.getByRole('heading', { name: 'The home' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Open building' })).toBeNull();
  });

  it('remembers a field checked and found unknown, and forgets it once known', async () => {
    const user = userEvent.setup();
    renderAt(`/unit/${ids.u1504}/edit`);
    await user.click(await screen.findByRole('button', { name: 'Mark Balcony unknown' }));
    await user.click(screen.getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(path()).toBe(`/unit/${ids.u1504}`));
    expect((await db.units.get(ids.u1504))?.checkedUnknown).toEqual([
      { field: 'unit.balcony', at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
    ]);

    // Open the form afresh, as a later visit would.
    cleanup();
    renderAt(`/unit/${ids.u1504}/edit`);
    expect(await screen.findByRole('button', { name: 'Mark Balcony unknown' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(row('Balcony')).not.toHaveAttribute('data-empty');
    await user.click(within(row('Balcony')).getByRole('radio', { name: 'No' }));
    await user.click(screen.getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(path()).toBe(`/unit/${ids.u1504}`));
    const saved = await db.units.get(ids.u1504);
    expect(saved?.balcony).toBe(false);
    expect(saved?.checkedUnknown).toEqual([]);
  });

  it('names a building in a complex of several, shown together', async () => {
    const user = userEvent.setup();
    renderAt(`/building/${ids.riverlight}/edit`);
    expect(await screen.findByRole('textbox', { name: 'Name' })).toHaveValue('Riverlight');
    await user.click(screen.getByRole('checkbox', { name: 'This complex has several buildings' }));
    // A box with suggestions (names used before) reads as a combobox.
    expect(screen.getByRole('combobox', { name: 'Complex name' })).toHaveValue('Riverlight');
    await user.type(screen.getByRole('textbox', { name: 'This building’s name' }), 'North Tower');
    await user.click(screen.getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(path()).toBe(`/building/${ids.riverlight}`));
    expect(await db.buildings.get(ids.riverlight)).toMatchObject({
      name: 'North Tower',
      complexName: 'Riverlight',
    });
    expect(await screen.findByRole('heading', { name: 'North Tower · Riverlight' })).toBeVisible();

    // Unticking keeps the complex's name as the name and says the building's own goes
    cleanup();
    renderAt(`/building/${ids.riverlight}/edit`);
    await user.click(
      await screen.findByRole('checkbox', { name: 'This complex has several buildings' }),
    );
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Riverlight');
    expect(screen.getByText(/“North Tower” was this building’s own name/)).toBeVisible();
  });
});

describe('moving between a unit’s form and its building’s', () => {
  it('keeps one form in the history: Save on the second goes back to where the first was opened', async () => {
    const user = userEvent.setup();
    router = createMemoryRouter(routes, { initialEntries: [`/unit/${ids.u1504}`] });
    render(<RouterProvider router={router} />);
    await screen.findByRole('heading', { name: 'Unit 1504' });
    await user.click(screen.getByRole('link', { name: /^Edit( building)?$/ }));
    await screen.findByRole('heading', { level: 1, name: 'Riverlight · Unit 1504' });
    // Back and forth a few times
    for (let i = 0; i < 2; i++) {
      await user.click(screen.getByRole('link', { name: 'Edit building' }));
      await screen.findByRole('heading', { level: 1, name: 'Riverlight · building' });
      await user.click(screen.getByRole('link', { name: 'Unit 1504' }));
      await screen.findByRole('heading', { level: 1, name: 'Riverlight · Unit 1504' });
    }
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(path()).toBe(`/unit/${ids.u1504}`));
    expect(screen.getByRole('heading', { name: 'Unit 1504' })).toBeVisible();
  });
});
