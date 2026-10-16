import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { db } from '../../src/db/db';
import { DebugPage } from '../../src/ui/debug/DebugPage';

const renderPage = () =>
  render(
    <MemoryRouter>
      <DebugPage />
    </MemoryRouter>,
  );

const unitsStored = () =>
  within(screen.getByTestId('record-counts')).getByRole('row', { name: /^Units/ }).children[1];

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('DebugPage', () => {
  it('shows the database, empty counts and nothing to undo', async () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Data check' })).toBeVisible();
    expect(screen.getByText('rental-tracker-preview')).toBeVisible();
    await waitFor(() => expect(unitsStored()).toHaveTextContent('0'));
    expect(screen.getByRole('button', { name: 'Nothing to undo' })).toBeDisabled();
    expect(screen.getByText('Nothing has changed yet.')).toBeVisible();
  });

  it('loads sample data, then undoes and redoes it', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Load sample data' }));
    await waitFor(() =>
      expect(screen.getByTestId('debug-message')).toHaveTextContent(/Loaded \d+ units/),
    );
    await waitFor(() => expect(Number(unitsStored()?.textContent)).toBeGreaterThan(20));
    const loaded = Number(unitsStored()?.textContent);
    expect(
      within(await screen.findByTestId('history')).getByText('Load sample data'),
    ).toBeVisible();

    await user.click(await screen.findByRole('button', { name: 'Undo: Load sample data' }));
    await waitFor(() => expect(unitsStored()).toHaveTextContent('0'));

    await user.click(await screen.findByRole('button', { name: 'Redo: Load sample data' }));
    await waitFor(() => expect(unitsStored()).toHaveTextContent(String(loaded)));
  });

  it('makes test changes that each undo as one step', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Add a test unit' }));
    await waitFor(() => expect(unitsStored()).toHaveTextContent('1'));
    await user.click(screen.getByRole('button', { name: 'Raise a rent by $25' }));
    await screen.findByRole('button', { name: 'Undo: Change rent' });
    await user.click(screen.getByRole('button', { name: 'Delete a unit' }));
    await waitFor(() => expect(unitsStored()).toHaveTextContent('0'));
    await user.click(await screen.findByRole('button', { name: 'Undo: Delete unit' }));
    await waitFor(() => expect(unitsStored()).toHaveTextContent('1'));
  });
});
