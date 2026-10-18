import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { db } from '../../src/db/db';
import { ensureMe, getMe } from '../../src/db/me';
import { routes } from '../../src/routes';
import { resetUi } from '../../src/state/ui';

/** M6: Settings → People (your name, other people). */

beforeEach(async () => {
  localStorage.clear();
  resetUi();
  await db.delete();
  await db.open();
  await ensureMe(db);
});

const renderAt = (path: string) => {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
};

const livePeople = async () =>
  (await db.people.toArray())
    .filter((p) => !p.deletedAt)
    .map((p) => p.name)
    .sort();

describe('Settings → People', () => {
  it('renames you and changes your color', async () => {
    const user = userEvent.setup();
    renderAt('/settings/people');
    const you = await screen.findByRole('region', { name: 'You' });
    const name = await within(you).findByRole('textbox', { name: 'Your name' });
    await user.clear(name);
    await user.type(name, 'Jordan');
    await user.click(within(you).getByRole('button', { name: 'Save name' }));
    await waitFor(async () => expect((await getMe(db)).name).toBe('Jordan'));
    await user.selectOptions(within(you).getByRole('combobox', { name: 'Your color' }), 'navy');
    await waitFor(async () => expect((await getMe(db)).color).toBe('navy'));
    expect(screen.getByRole('link', { name: 'People' })).toHaveAttribute('aria-current', 'page');
  });

  it('adds, renames and removes other people, with Undo', async () => {
    const user = userEvent.setup();
    renderAt('/settings/people');
    const others = await screen.findByRole('region', { name: 'Other people' });
    expect(others).toHaveTextContent('Nobody else yet.');

    await user.type(within(others).getByRole('textbox', { name: 'New person’s name' }), 'Alex');
    await user.click(within(others).getByRole('button', { name: 'Add person' }));
    await within(others).findByRole('textbox', { name: 'Alex’s name' });
    expect(await livePeople()).toEqual(['Alex', 'Me']);

    // A second Alex is refused, with a message.
    await user.type(within(others).getByRole('textbox', { name: 'New person’s name' }), 'alex');
    await user.click(within(others).getByRole('button', { name: 'Add person' }));
    expect(await within(others).findByRole('alert')).toHaveTextContent(
      'There’s already someone called alex.',
    );

    const alexName = within(others).getByRole('textbox', { name: 'Alex’s name' });
    await user.clear(alexName);
    await user.type(alexName, 'Sam{Enter}');
    await within(others).findByRole('textbox', { name: 'Sam’s name' });

    await user.click(within(others).getByRole('button', { name: 'Remove…' }));
    await user.click(within(others).getByRole('button', { name: 'Remove Sam' }));
    await waitFor(() => expect(others).toHaveTextContent('Nobody else yet.'));
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    await within(others).findByRole('textbox', { name: 'Sam’s name' });
    expect(await livePeople()).toEqual(['Me', 'Sam']);
  });
});
