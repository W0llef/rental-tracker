import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppShell as Shell } from '../../src/ui/shell/AppShell';

const AppShell = () => (
  <MemoryRouter>
    <Shell />
  </MemoryRouter>
);

describe('AppShell', () => {
  it('shows the title, the three regions and the build info', () => {
    render(<AppShell />);
    expect(screen.getByRole('heading', { level: 1, name: 'Rental Unit Tracker' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'List' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Details' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Map' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: /Search units/ })).toBeInTheDocument();
    expect(screen.getByTestId('build-info')).toHaveTextContent('Database:');
  });

  it('is marked as a non-live build outside production', () => {
    render(<AppShell />);
    // Tests run as the "dev" channel, which must warn that it is not the live app.
    expect(screen.getByRole('status')).toHaveTextContent('never your real data');
  });

  it('switches the phone tabs and marks the current one', async () => {
    const user = userEvent.setup();
    const { container } = render(<AppShell />);
    const list = screen.getByRole('button', { name: 'List' });
    const map = screen.getByRole('button', { name: 'Map' });
    expect(list).toHaveAttribute('aria-current', 'page');
    expect(map).not.toHaveAttribute('aria-current');

    await user.click(map);
    expect(map).toHaveAttribute('aria-current', 'page');
    expect(list).not.toHaveAttribute('aria-current');
    expect(container.firstElementChild).toHaveAttribute('data-tab', 'map');
  });

  it('links to the data check page', () => {
    render(<AppShell />);
    expect(screen.getByRole('link', { name: 'Data check' })).toHaveAttribute('href', '/debug');
  });
});
