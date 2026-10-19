import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { undo } from '../../src/commands/undo';
import { db } from '../../src/db/db';
import { routes } from '../../src/routes';

/** Settings → Data (was the Data check page until the M7 review). */

const renderAt = (path: string) => {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
};

const unitsStored = () =>
  within(screen.getByTestId('record-counts')).getByRole('row', { name: /^Units/ }).children[1];

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('Settings → Data', () => {
  it('opens from the old #/debug link and shows what is stored', async () => {
    const router = renderAt('/debug');
    expect(await screen.findByRole('heading', { level: 2, name: 'Data' })).toBeVisible();
    expect(router.state.location.pathname).toBe('/settings/data');
    expect(screen.getByText('rental-tracker-preview')).toBeVisible();
    await waitFor(() => expect(unitsStored()).toHaveTextContent('0'));
    expect(screen.getByRole('link', { name: 'History' })).toHaveAttribute('href', '/history');
  });

  it('loads sample data and makes test changes, each one undo step', async () => {
    const user = userEvent.setup();
    renderAt('/settings/data');
    await user.click(await screen.findByRole('button', { name: 'Load sample data' }));
    await waitFor(() =>
      expect(screen.getByTestId('debug-message')).toHaveTextContent(/Loaded \d+ units/),
    );
    await waitFor(() => expect(Number(unitsStored()?.textContent)).toBeGreaterThan(20));
    const loaded = Number(unitsStored()?.textContent);
    await user.click(screen.getByRole('button', { name: 'Delete a unit' }));
    await waitFor(() => expect(unitsStored()).toHaveTextContent(String(loaded - 1)));
    await undo(db);
    await waitFor(() => expect(unitsStored()).toHaveTextContent(String(loaded)));
  });
});
