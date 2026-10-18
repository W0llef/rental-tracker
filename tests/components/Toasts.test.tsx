import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { createBuilding, createUnit, updateUnit } from '../../src/commands/records';
import { setStatus } from '../../src/commands/triage';
import { db } from '../../src/db/db';
import { ensureMe } from '../../src/db/me';
import { makeAddress } from '../../src/model/factories';
import { watchActionsForToasts } from '../../src/state/toasts';
import { resetUi, useUi } from '../../src/state/ui';
import { Notice } from '../../src/ui/shell/Notice';

/** M7: a toast after every action, with Undo, and Redo after an undo (PLAN.md §5.6). */

let stop: () => void;
beforeEach(async () => {
  resetUi();
  await db.delete();
  await db.open();
  await ensureMe(db);
  stop = watchActionsForToasts(db);
});
afterEach(() => stop());

async function unit() {
  const b = await createBuilding(db, {
    address: makeAddress('200 Portland Ave S', 'Minneapolis'),
    name: 'Riverlight',
  });
  return createUnit(db, { buildingId: b.id, unitNumber: '908', rent: 1600 });
}

describe('toasts', () => {
  it('say what an action did, and Undo / Redo it', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Notice />
      </MemoryRouter>,
    );
    const u = await unit();
    await updateUnit(db, u.id, { rent: 1550 });
    const toast = await screen.findByText('Rent $1,600 → $1,550 on Unit 908 at Riverlight');
    expect(toast.closest('[role="status"]')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(async () => expect((await db.units.get(u.id))?.rent).toBe(1600));
    await screen.findByText('Undid: Rent $1,600 → $1,550 on Unit 908 at Riverlight');

    await user.click(screen.getByRole('button', { name: 'Redo' }));
    await waitFor(async () => expect((await db.units.get(u.id))?.rent).toBe(1550));
    await screen.findByText('Redid: Rent $1,600 → $1,550 on Unit 908 at Riverlight');
  });

  it('Undo on an older toast undoes just that action', async () => {
    const u = await unit();
    await setStatus(db, u.id, 'toured');
    await waitFor(() => expect(useUi.getState().notice?.text).toMatch(/Toured/));
    const toast = useUi.getState().notice;
    await updateUnit(db, u.id, { rent: 1500 });
    toast?.button?.run();
    await waitFor(async () =>
      expect(await db.units.get(u.id)).toMatchObject({ status: 'new', rent: 1500 }),
    );
  });

  it('a caller’s own words join its action’s toast, keeping Undo', async () => {
    const u = await unit();
    await setStatus(db, u.id, 'applied');
    useUi.getState().showNotice('Applied. Good luck!');
    // The action's toast arrives a moment later: the caller's words stay and gain Undo.
    await waitFor(() => expect(useUi.getState().notice?.button?.label).toBe('Undo'));
    expect(useUi.getState().notice?.text).toBe('Applied. Good luck!');
  });
});
