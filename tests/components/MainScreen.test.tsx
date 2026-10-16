import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { addListing, addNote, createBuilding, createUnit } from '../../src/commands/records';
import { db } from '../../src/db/db';
import { makeAddress } from '../../src/model/factories';
import { routes } from '../../src/routes';
import { resetUi } from '../../src/state/ui';

/** M2: list, search, sort, Units/Buildings and the read-only detail panels. */

let router: ReturnType<typeof createMemoryRouter>;
const renderAt = (path = '/') => {
  router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(<RouterProvider router={router} />);
};
const path = () => router.state.location.pathname;

const list = () => screen.getByRole('list', { name: /^(Units|Buildings)$/ });
const cardTitles = () =>
  within(list())
    .getAllByRole('link')
    .map((a) => a.querySelector('[class*="unitTitle"]')?.textContent);

let ids: {
  riverlight: string;
  larkin: string;
  u1504: string;
  u908: string;
  plan: string;
  u310: string;
};

async function seed() {
  const riverlight = await createBuilding(db, {
    name: 'Riverlight',
    address: makeAddress('200 Portland Ave S', 'Minneapolis', 'MN', '55401'),
    neighborhood: { name: 'Downtown East', source: 'manual' },
    buildingType: 'high-rise',
    floors: 24,
  });
  const larkin = await createBuilding(db, {
    name: 'The Larkin',
    address: makeAddress('1010 Nicollet Mall', 'Minneapolis', 'MN', '55403'),
    neighborhood: { name: 'Downtown West', source: 'manual' },
  });
  const u1504 = await createUnit(db, {
    buildingId: riverlight.id,
    unitNumber: '1504',
    bedrooms: 1,
    bathrooms: 1,
    squareFeet: 720,
    floor: 15,
    exposure: ['S', 'W'],
    rent: 1650,
    status: 'shortlisted',
    flag: 'pick',
    rating: 4,
    colorLabel: 'blue',
  });
  const u908 = await createUnit(db, { buildingId: riverlight.id, unitNumber: '908', rent: null });
  const plan = await createUnit(db, {
    buildingId: larkin.id,
    isFloorPlanOnly: true,
    floorPlanName: 'Plan C',
    rent: 2560,
    rentIsFrom: true,
  });
  const u310 = await createUnit(db, {
    buildingId: larkin.id,
    unitNumber: '310',
    rent: 1295,
    status: 'declined',
    flag: 'reject',
    rejectReasonIds: ['too-far'],
  });
  await addListing(db, {
    unitId: u1504.id,
    site: 'zillow',
    url: 'https://www.zillow.com/homedetails/example',
    firstSeen: '2026-09-28',
    lastSeen: '2026-10-12',
    observations: [
      { date: '2026-09-28', rent: 1695, note: null },
      { date: '2026-10-12', rent: 1650, note: null },
    ],
  });
  await addNote(db, { unitId: u1504.id, text: 'Corner unit, light all afternoon', kind: 'tour' });
  ids = {
    riverlight: riverlight.id,
    larkin: larkin.id,
    u1504: u1504.id,
    u908: u908.id,
    plan: plan.id,
    u310: u310.id,
  };
}

beforeEach(async () => {
  localStorage.clear();
  resetUi();
  await db.delete();
  await db.open();
});

describe('main screen without data', () => {
  it('says there are no units and points to sample data on non-live builds', async () => {
    renderAt();
    expect(await screen.findByText('No units yet')).toBeVisible();
    expect(screen.getByRole('link', { name: 'load sample data' })).toHaveAttribute(
      'href',
      '/debug',
    );
  });
});

describe('main screen with units', () => {
  beforeEach(seed);

  it('lists units by rent, low to high, with unknown rent last', async () => {
    renderAt();
    await waitFor(() => expect(cardTitles()).toHaveLength(4));
    expect(cardTitles()).toEqual(['Unit 310', 'Unit 1504', 'Plan C', 'Unit 908']);
    expect(screen.getByTestId('list-count')).toHaveTextContent('4 units in 2 buildings');
  });

  it('reverses the sort and keeps unknowns last; remembers the choice', async () => {
    const user = userEvent.setup();
    renderAt();
    await waitFor(() => expect(cardTitles()).toHaveLength(4));
    await user.click(screen.getByRole('button', { name: /Sorted low to high/ }));
    expect(cardTitles()).toEqual(['Plan C', 'Unit 1504', 'Unit 310', 'Unit 908']);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'rating');
    expect(cardTitles()[0]).toBe('Unit 1504'); // the only rated unit; unrated are unknown
    expect(JSON.parse(localStorage.getItem('rental-tracker-preview.list') ?? '{}')).toMatchObject({
      unitSort: { key: 'rating', dir: 'desc' },
    });
  });

  it('shows card details: specs, floor plan, flag, rejection reason', async () => {
    renderAt();
    const card = await screen.findByRole('link', { name: /Unit 1504/ });
    expect(card).toHaveTextContent('720 ft²');
    expect(card).toHaveTextContent('Floor 15');
    expect(card).toHaveTextContent('$1,650/mo rent');
    expect(card).toHaveTextContent('Pick');
    expect(within(card).getByRole('img', { name: '4 of 5 stars' })).toBeInTheDocument();
    expect(within(card).getByRole('img', { name: 'Label: Blue' })).toBeInTheDocument();
    expect(card).toHaveTextContent('Shortlisted');
    expect(screen.getByRole('link', { name: /Plan C/ })).toHaveTextContent('from $2,560');
    expect(screen.getByRole('link', { name: /Unit 310/ })).toHaveTextContent('Rejected: Too far');
    expect(screen.getByRole('link', { name: /Unit 908/ })).toHaveTextContent('Rent unknown');
    // A new unit says "New" once, in its status pill (no separate badge)
    expect(within(screen.getByRole('link', { name: /Unit 908/ })).getAllByText('New')).toHaveLength(
      1,
    );
  });

  it('searches buildings, units and notes', async () => {
    const user = userEvent.setup();
    renderAt();
    await waitFor(() => expect(cardTitles()).toHaveLength(4));
    const search = screen.getByRole('searchbox', { name: /Search units/ });

    await user.type(search, 'larkin');
    expect(cardTitles()).toEqual(['Unit 310', 'Plan C']);
    expect(screen.getByTestId('list-count')).toHaveTextContent('2 of 4 units match');

    await user.clear(search);
    await user.type(search, 'afternoon');
    expect(cardTitles()).toEqual(['Unit 1504']);

    await user.type(search, ' nothing-like-this');
    expect(screen.getByText(/No units match/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(cardTitles()).toHaveLength(4);
  });

  it('opens a unit in the detail panel and closes it again', async () => {
    const user = userEvent.setup();
    renderAt();
    await user.click(await screen.findByRole('link', { name: /Unit 1504/ }));
    expect(path()).toBe(`/unit/${ids.u1504}`);

    const details = screen.getByRole('region', { name: 'Details' });
    expect(within(details).getByRole('heading', { level: 2, name: 'Unit 1504' })).toBeVisible();
    expect(details).toHaveTextContent('Riverlight, 200 Portland Ave S');
    expect(details).toHaveTextContent('Downtown East');
    expect(within(details).getByRole('img', { name: 'Faces south and west' })).toBeInTheDocument();
    expect(
      within(details).getByRole('img', { name: /Rent dropped from \$1,695 on Sep 28 to \$1,650/ }),
    ).toBeInTheDocument();
    expect(within(details).getByRole('link', { name: /Zillow listing/ })).toHaveAttribute(
      'href',
      'https://www.zillow.com/homedetails/example',
    );
    expect(within(details).getAllByRole('link', { name: /Zillow/ })[0]).toHaveAttribute(
      'target',
      '_blank',
    );
    expect(details).toHaveTextContent('Corner unit, light all afternoon');
    expect(within(details).getAllByText('Unknown').length).toBeGreaterThan(5);
    expect(screen.getByRole('link', { name: /Unit 1504/ })).toHaveAttribute('aria-current', 'true');

    await user.click(screen.getByRole('button', { name: 'Close details' }));
    expect(path()).toBe('/');
    expect(screen.queryByRole('heading', { level: 2, name: 'Unit 1504' })).toBeNull();
  });

  it('shows buildings and opens a building with its units', async () => {
    const user = userEvent.setup();
    renderAt();
    await waitFor(() => expect(cardTitles()).toHaveLength(4));
    await user.click(screen.getByRole('button', { name: 'Buildings' }));
    // Lowest rent first: The Larkin ($1,295) before Riverlight ($1,650)
    expect(cardTitles()).toEqual(['The Larkin', 'Riverlight']);
    expect(screen.getByTestId('list-count')).toHaveTextContent('2 buildings with 4 units');
    expect(screen.getByRole('link', { name: /Riverlight/ })).toHaveTextContent('$1,650/mo rent');
    expect(screen.getByRole('link', { name: /Riverlight/ })).toHaveTextContent('2 of your units');

    await user.click(screen.getByRole('link', { name: /The Larkin/ }));
    expect(path()).toBe(`/building/${ids.larkin}`);
    const details = screen.getByRole('region', { name: 'Details' });
    expect(within(details).getByRole('heading', { level: 2, name: 'The Larkin' })).toBeVisible();
    expect(details).toHaveTextContent('1010 Nicollet Mall, Minneapolis, MN 55403');

    await user.click(within(details).getByRole('link', { name: /Plan C/ }));
    expect(path()).toBe(`/unit/${ids.plan}`);
    expect(within(details).getByRole('heading', { level: 2, name: 'Plan C' })).toBeVisible();
    expect(details).toHaveTextContent('Floor plan: no specific unit yet.');
  });

  it('narrows the buildings view to matching units when searching', async () => {
    const user = userEvent.setup();
    renderAt();
    await waitFor(() => expect(cardTitles()).toHaveLength(4));
    await user.click(screen.getByRole('button', { name: 'Buildings' }));
    await user.type(screen.getByRole('searchbox'), '1504');
    expect(cardTitles()).toEqual(['Riverlight']);
    expect(screen.getByRole('link', { name: /Riverlight/ })).toHaveTextContent(
      '1 of 2 of your units match',
    );
  });

  it('keeps up with keys pressed faster than the screen updates', async () => {
    renderAt();
    await waitFor(() => expect(cardTitles()).toHaveLength(4));
    await act(async () => {}); // let the keyboard handler see the loaded list
    // Three presses in one go, before React re-renders between them
    act(() => {
      for (let i = 0; i < 3; i++)
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
    });
    await waitFor(() => expect(path()).not.toBe('/'));
    const third = within(list()).getAllByRole('link')[2]?.getAttribute('href');
    expect(path()).toBe(third);
  });

  it('moves through the list with the keyboard', async () => {
    const user = userEvent.setup();
    renderAt();
    await waitFor(() => expect(cardTitles()).toHaveLength(4));

    await user.keyboard('j');
    expect(path()).toBe(`/unit/${ids.u310}`);
    await user.keyboard('{ArrowDown}');
    expect(path()).toBe(`/unit/${ids.u1504}`);
    await user.keyboard('k');
    expect(path()).toBe(`/unit/${ids.u310}`);
    await user.keyboard('{Escape}');
    expect(path()).toBe('/');

    await user.keyboard('/');
    expect(screen.getByRole('searchbox')).toHaveFocus();
    await user.keyboard('j'); // typing in search doesn't move the selection
    expect(path()).toBe('/');
    expect(screen.getByRole('searchbox')).toHaveValue('j');
    await user.keyboard('{Escape}'); // clears
    expect(screen.getByRole('searchbox')).toHaveValue('');
    await user.keyboard('{Escape}'); // leaves the field
    expect(screen.getByRole('searchbox')).not.toHaveFocus();

    await user.keyboard('b');
    expect(screen.getByRole('button', { name: 'Buildings' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.keyboard('j');
    expect(path()).toBe(`/building/${ids.larkin}`);
  });

  it('keeps Back working: moving with the keyboard replaces the history entry', async () => {
    const user = userEvent.setup();
    renderAt();
    await waitFor(() => expect(cardTitles()).toHaveLength(4));
    await user.keyboard('jjj');
    expect(path()).toBe(`/unit/${ids.plan}`);
    await act(() => router.navigate(-1));
    expect(path()).toBe('/');
  });

  it('explains a link to a unit that is not in the list', async () => {
    renderAt('/unit/does-not-exist');
    expect(await screen.findByText('This unit isn’t in your list')).toBeVisible();
  });
});
