import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import fixture from '../fixtures/backup-v1.json';
import { createBuilding, createUnit } from '../../src/commands/records';
import { db } from '../../src/db/db';
import { getMeta, META_KEYS, setMeta } from '../../src/db/meta';
import { makeAddress } from '../../src/model/factories';
import { routes } from '../../src/routes';
import { resetUi } from '../../src/state/ui';
import { UpgradeGate } from '../../src/ui/shell/UpgradeGate';

/** M5: the backup reminder, Settings → Backup and restore, and the pre-update screen. */

const downloads: { name: string; text: string }[] = [];

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => 'blob:test');
  URL.revokeObjectURL = vi.fn();
});

beforeEach(async () => {
  localStorage.clear();
  resetUi();
  downloads.length = 0;
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push({ name: this.download, text: '' });
  });
  await db.delete();
  await db.open();
});

afterEach(() => vi.restoreAllMocks());

const renderAt = (path: string) => {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
};

async function seed() {
  const b = await createBuilding(db, {
    name: 'Riverlight',
    address: makeAddress('200 Portland Ave S', 'Minneapolis', 'MN', '55401'),
  });
  await createUnit(db, { buildingId: b.id, unitNumber: '1504', rent: 1650 });
  await createUnit(db, { buildingId: b.id, unitNumber: '908', rent: 1490 });
}

describe('backup reminder', () => {
  it('stays away while there is no data', async () => {
    renderAt('/');
    expect(await screen.findByText('No units yet')).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Backup reminder' })).toBeNull();
  });

  it('asks for a first backup, and goes away once there is one', async () => {
    await seed();
    renderAt('/');
    const banner = await screen.findByRole('region', { name: 'Backup reminder' });
    expect(banner).toHaveTextContent('No backup yet.');
    await userEvent.click(within(banner).getByRole('button', { name: 'Back up data' }));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Backup reminder' })).toBeNull(),
    );
    expect(downloads.map((d) => d.name)).toEqual([
      expect.stringMatching(/^rental-tracker-preview-backup-\d{4}-\d{2}-\d{2}\.json$/),
    ]);
    expect(await getMeta(db, META_KEYS.lastBackupAt)).not.toBeNull();
    expect(await screen.findByText(/^Backed up:/)).toBeVisible();
  });

  it('says how old the last backup is, and can wait a day', async () => {
    await seed();
    await setMeta(db, META_KEYS.lastBackupAt, new Date(Date.now() - 9 * 86_400_000).toISOString());
    renderAt('/');
    const banner = await screen.findByRole('region', { name: 'Backup reminder' });
    expect(banner).toHaveTextContent('Last backup 9 days ago.');
    await userEvent.click(within(banner).getByRole('button', { name: 'Later' }));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Backup reminder' })).toBeNull(),
    );
  });

  it('leaves a recent backup alone', async () => {
    await seed();
    await setMeta(db, META_KEYS.lastBackupAt, new Date().toISOString());
    renderAt('/');
    expect((await screen.findAllByText('Riverlight')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('region', { name: 'Backup reminder' })).toBeNull();
  });
});

describe('Settings → Backup and restore', () => {
  const fixtureFile = (text = JSON.stringify(fixture)) =>
    new File([text], 'rental-tracker-backup-2026-10-15.json', { type: 'application/json' });

  it('opens from the top bar', async () => {
    const router = renderAt('/');
    await userEvent.click(await screen.findByRole('link', { name: 'Settings' }));
    await screen.findByRole('heading', { name: 'Backup and restore', level: 2 });
    expect(router.state.location.pathname).toBe('/settings/backup');
  });

  it('restores a file after showing what it holds and what it replaces', async () => {
    await seed();
    renderAt('/settings/backup');
    await waitFor(() => expect(screen.getByTestId('last-backup')).toHaveTextContent('Never'));

    await userEvent.upload(screen.getByLabelText('Backup file to restore'), fixtureFile());
    const review = await screen.findByTestId('restore-review');
    expect(within(review).getByTestId('restore-contains')).toHaveTextContent(
      '1 unit, 1 building, 1 listing, 1 note, 2 collections and 1 photo',
    );
    await waitFor(() =>
      expect(review).toHaveTextContent(
        '2 units, 1 building, 0 listings and 0 notes in this browser now',
      ),
    );

    await userEvent.click(within(review).getByRole('button', { name: 'Replace with this backup' }));
    expect(await screen.findByText(/^Restored 1 unit/)).toHaveTextContent(
      'What was here before is kept under Safety copies.',
    );
    expect(await db.units.count()).toBe(2); // one active, one deleted
    expect(await db.buildings.get('b-1')).toBeDefined();
    expect(await db.changeLog.count()).toBe(0);

    const copies = await screen.findByTestId('snapshot-list');
    expect(copies).toHaveTextContent('Before restoring a backup');
    expect(copies).toHaveTextContent('2 units, 1 building');
  });

  it('can be cancelled without changing anything', async () => {
    await seed();
    renderAt('/settings/backup');
    await userEvent.upload(await screen.findByLabelText('Backup file to restore'), fixtureFile());
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('restore-review')).toBeNull();
    expect(await db.units.count()).toBe(2);
    expect(await db.snapshots.count()).toBe(0);
  });

  it('explains a file it can’t use', async () => {
    renderAt('/settings/backup');
    await userEvent.upload(
      await screen.findByLabelText('Backup file to restore'),
      fixtureFile('{"notes": "hello"}'),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'isn’t a backup from Rental Unit Tracker',
    );
  });

  it('changes the reminder interval as an undoable setting', async () => {
    renderAt('/settings/backup');
    const select = await screen.findByRole('combobox', { name: 'Remind me to back up' });
    await waitFor(() => expect(select).toBeEnabled());
    await userEvent.selectOptions(select, 'After 14 days');
    await waitFor(async () =>
      expect((await db.settings.get('app'))?.backup.remindEveryDays).toBe(14),
    );
    expect((await db.changeLog.toArray()).map((e) => e.label)).toEqual(['Change backup reminder']);
  });

  it('shows storage facts', async () => {
    renderAt('/settings/storage');
    const fact = await screen.findByTestId('persisted');
    await waitFor(() => expect(fact).toHaveTextContent('This browser doesn’t say'));
  });
});

describe('before an update that changes the data format', () => {
  it('offers a backup in the old format, then continues', async () => {
    const onContinue = vi.fn();
    render(
      <UpgradeGate
        pending={{ fromVersion: 1, toVersion: 2 }}
        data={fixture.data}
        onContinue={onContinue}
      />,
    );
    expect(
      screen.getByRole('heading', { name: 'This update changes how your data is stored' }),
    ).toBeVisible();
    expect(screen.getByText('1 → 2')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Download backup' }));
    expect(downloads).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onContinue).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-/));
  });

  it('lets you continue without one', async () => {
    const onContinue = vi.fn();
    render(
      <UpgradeGate
        pending={{ fromVersion: 1, toVersion: 2 }}
        data={fixture.data}
        onContinue={onContinue}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Continue without a backup' }));
    expect(onContinue).toHaveBeenCalledWith(null);
  });
});
