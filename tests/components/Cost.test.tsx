import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { setLeaseLength, updateCostProfile } from '../../src/commands/cost';
import { createBuilding, createUnit, getSettings, updateUnit } from '../../src/commands/records';
import { unitCost } from '../../src/domain/cost';
import { db } from '../../src/db/db';
import { ensureMe } from '../../src/db/me';
import { UTILITY_KEYS } from '../../src/model';
import type { Unit } from '../../src/model';
import { makeAddress } from '../../src/model/factories';
import { routes } from '../../src/routes';
import { resetUi } from '../../src/state/ui';

/** M9: cost profile, the unit's Monthly cost section, lease length, totals and cost limits. */

const renderAt = (path: string) =>
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />);

const included = Object.fromEntries(
  UTILITY_KEYS.map((k) => [k, { mode: 'included' }]),
) as Unit['utilities'];

let unitId = '';
let cheapId = '';

beforeEach(async () => {
  localStorage.clear();
  resetUi();
  await db.delete();
  await db.open();
  await ensureMe(db);
  const b = await createBuilding(db, {
    name: 'Riverlight',
    address: makeAddress('200 Portland Ave S', 'Minneapolis'),
  });
  const u = await createUnit(db, {
    buildingId: b.id,
    unitNumber: '1504',
    rent: 1650,
    squareFeet: 720,
    leaseTermsMonths: [12, 15],
    rentByTerm: [
      { months: 12, rent: 1650 },
      { months: 15, rent: 1595 },
    ],
    utilities: { ...included, electric: null },
    parking: { spacesIncluded: 1, extraSpaceCost: null, type: 'garage' },
  });
  const cheap = await createUnit(db, {
    buildingId: b.id,
    unitNumber: '201',
    rent: 1500,
    squareFeet: 500,
    utilities: included,
    parking: { spacesIncluded: 0, extraSpaceCost: 250, type: 'garage' },
  });
  unitId = u.id;
  cheapId = cheap.id;
});

const costRegion = () => screen.getByRole('region', { name: 'Monthly cost' });
const line = (label: string) =>
  within(costRegion())
    .getAllByRole('listitem')
    .find((li) => li.firstElementChild?.textContent === label)!;

describe('the unit’s monthly cost', () => {
  it('shows each line, the total, move-in cost and cost per ft²', async () => {
    renderAt(`/unit/${unitId}`);
    // 1650 rent + 53 electric (assumed) + 15 renters insurance; parking included
    await waitFor(() => expect(line('Total')).toHaveTextContent('$1,718/mo'));
    expect(line('Electric')).toHaveTextContent('assumed');
    expect(line('Parking')).toHaveTextContent('1 space included');
    expect(line('Total')).toHaveTextContent('1 of the lines is assumed');
    expect(costRegion()).toHaveTextContent('Move-in cost$1,650');
    expect(costRegion()).toHaveTextContent('$2.39/ft²');
    const plate = screen.getByRole('article').querySelector('header')!;
    expect(plate).toHaveTextContent('$1,718 /mo');
    expect(plate).toHaveTextContent('$1,650 rent, 1 assumed');
  });

  it('picks a lease length and uses the rent for it', async () => {
    const user = userEvent.setup();
    renderAt(`/unit/${unitId}`);
    const select = await screen.findByRole('combobox', { name: 'Lease length' });
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([
      'Your default (12 months, $1,650 rent)',
      '12 months, $1,650 rent',
      '15 months, $1,595 rent',
      'Other…',
    ]);
    await user.selectOptions(select, '15');
    await waitFor(() => expect(line('Total')).toHaveTextContent('$1,663/mo'));
    expect(line('Rent')).toHaveTextContent('for a 15-month lease');
    expect((await db.units.get(unitId))?.plannedLeaseMonths).toBe(15);

    await user.selectOptions(select, 'other');
    await user.type(screen.getByRole('textbox', { name: 'Months' }), '9{Enter}');
    await waitFor(async () => expect((await db.units.get(unitId))?.plannedLeaseMonths).toBe(9));
    await waitFor(() => expect(line('Rent')).toHaveTextContent('$1,650'));
  });

  it('sets an estimate for this unit instead of the profile’s', async () => {
    const user = userEvent.setup();
    renderAt(`/unit/${unitId}`);
    await user.click(await screen.findByRole('button', { name: 'Set electric for this unit' }));
    const box = screen.getByRole('textbox', { name: 'Your estimate for this unit' });
    expect(box).toHaveAttribute('placeholder', '53');
    await user.type(box, '90{Enter}');
    await waitFor(() => expect(line('Electric')).toHaveTextContent('$90'));
    expect(line('Electric')).toHaveTextContent('your estimate here');
    expect((await db.units.get(unitId))?.costOverrides).toEqual({ electric: 90 });
  });
});

describe('Settings → Cost profile', () => {
  it('changes an estimate on leaving the box, and the total follows', async () => {
    const user = userEvent.setup();
    renderAt('/settings/cost');
    const electric = await screen.findByRole('textbox', { name: 'Electric per month' });
    await user.clear(electric);
    await user.type(electric, '75');
    await user.tab();
    await waitFor(async () =>
      expect((await getSettings(db)).costProfile.items.electric.monthly).toBe(75),
    );
    const cats = screen.getByRole('textbox', { name: 'Cats' });
    await user.clear(cats);
    await user.type(cats, 'two{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a number of cats');
    await user.click(screen.getByRole('checkbox', { name: /Spread one-time fees/ }));
    await waitFor(async () =>
      expect((await getSettings(db)).costProfile.amortizeOneTimeFees).toBe(true),
    );
  });
});

describe('the list', () => {
  it('leads cards with the total and sorts by it', async () => {
    renderAt('/');
    const cards = await screen.findAllByRole('link', { name: /Unit (1504|201)/ });
    // 201: 1500 + 250 parking + 15 insurance = 1765, above 1504's 1718
    expect(cards.map((c) => c.textContent?.match(/Unit \d+/)?.[0])).toEqual([
      'Unit 1504',
      'Unit 201',
    ]);
    expect(cards[1]).toHaveTextContent('$1,765/mo$1,500 rent');
  });

  it('limits the list by total cost', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await screen.findAllByRole('link', { name: /Unit (1504|201)/ });
    await user.click(screen.getByRole('button', { name: 'Cost limits' }));
    await user.type(screen.getByRole('textbox', { name: 'Total up to' }), '1750');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByTestId('list-count')).toHaveTextContent('1 of 2 units match');
    expect(screen.getByText('Total up to $1,750/mo')).toBeVisible();
    expect(screen.queryByRole('link', { name: /Unit 201/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Unit 1504/ })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByRole('link', { name: /Unit 201/ })).toBeVisible();
    expect(cheapId).toBeTruthy();
  });
});

describe('charges by lease length (M9 review)', () => {
  it('lets a charge differ by lease length in the form, and the costs follow', async () => {
    const user = userEvent.setup();
    render(
      <RouterProvider
        router={createMemoryRouter(routes, {
          initialEntries: ['/', `/unit/${unitId}/edit`],
          initialIndex: 1,
        })}
      />,
    );
    const group = await screen.findByRole('group', { name: 'Other charges by lease length' });
    await user.click(
      within(group).getByRole('button', { name: 'Deposit differs by lease length' }),
    );
    await user.type(
      within(group).getByRole('textbox', { name: 'Deposit on a 12-month lease' }),
      '500',
    );
    await user.type(
      within(group).getByRole('textbox', { name: 'Deposit on a 15-month lease' }),
      '250',
    );
    await user.click(screen.getByRole('button', { name: /^Save/ }));
    await waitFor(async () =>
      expect((await db.units.get(unitId))?.termCharges).toEqual(
        expect.arrayContaining([
          { charge: 'deposit', months: 12, amount: 500 },
          { charge: 'deposit', months: 15, amount: 250 },
        ]),
      ),
    );
    await setLeaseLength(db, unitId, 15);
    expect(
      unitCost((await db.units.get(unitId))!, undefined, (await getSettings(db)).costProfile).moveIn
        .parts,
    ).toContainEqual({ key: 'deposit', label: 'Deposit', amount: 250 });
  });

  it('marks units without your lease length and can leave them out', async () => {
    const user = userEvent.setup();
    await updateCostProfile(db, (p) => ({ ...p, defaultLeaseMonths: 18 }));
    await updateUnit(db, cheapId, { leaseTermsMonths: [18] });
    renderAt('/');
    const card = await screen.findByRole('link', { name: /Unit 1504/ });
    expect(card).toHaveTextContent('No 18-month lease');
    expect(within(card).getByTitle(/so its costs use the 15-month lease/)).toBeVisible();
    expect(screen.getByRole('link', { name: /Unit 201/ })).not.toHaveTextContent('lease');

    await user.click(screen.getByRole('button', { name: 'Cost limits' }));
    await user.click(
      screen.getByRole('checkbox', { name: /Only units that list your lease length/ }),
    );
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByTestId('list-count')).toHaveTextContent('1 of 2 units match');
    expect(screen.getByText('Listing your lease length')).toBeVisible();
    expect(screen.queryByRole('link', { name: /Unit 1504/ })).toBeNull();
  });

  it('explains in the unit’s monthly cost which lease length it used', async () => {
    await updateCostProfile(db, (p) => ({ ...p, defaultLeaseMonths: 18 }));
    renderAt(`/unit/${unitId}`);
    await waitFor(() =>
      expect(costRegion()).toHaveTextContent(
        'This unit doesn’t list an 18-month lease (it lists 12 and 15 months), so its costs use the 15-month lease.',
      ),
    );
    expect(line('Rent')).toHaveTextContent('$1,595');
  });

  it('says when a unit’s lease terms aren’t entered, or are unknown', async () => {
    renderAt(`/unit/${cheapId}`);
    await waitFor(() =>
      expect(costRegion()).toHaveTextContent(
        'No lease terms are entered for this unit yet, so its costs assume a 12-month lease',
      ),
    );
    await updateUnit(db, cheapId, { leaseTermsMonths: [] });
    await waitFor(() =>
      expect(costRegion()).toHaveTextContent(
        'This unit’s lease terms are unknown, so its costs assume a 12-month lease',
      ),
    );
  });
});
