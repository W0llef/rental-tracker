import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MapCard } from '../../src/ui/map/MapCard';
import type { CardRow } from '../../src/ui/map/MapCard';

const row = (id: string, rent: string, patch: Partial<CardRow> = {}): CardRow => ({
  key: `unit:${id}`,
  content: { typeIcon: null, segments: [{ field: 'rent', text: rent }] },
  type: 'apartment',
  stripe: 'red',
  newMark: null,
  selected: false,
  rejected: false,
  faded: false,
  hot: false,
  label: `Riverlight, Unit ${id}`,
  title: `Unit ${id}`,
  ...patch,
});

describe('MapCard', () => {
  it('lists the units, opens one, opens the building and closes', async () => {
    const user = userEvent.setup();
    const selected: string[] = [];
    let opened = 0;
    let closed = 0;
    render(
      <MapCard
        id="b1"
        name="Riverlight"
        rows={[row('1601', '$2,395', { newMark: 'tag' }), row('1202', '$2,435')]}
        photo={false}
        onSelect={(k) => selected.push(k)}
        onOpenBuilding={() => opened++}
        onClose={() => closed++}
      />,
    );
    const card = screen.getByRole('group', { name: 'Units at Riverlight' });
    expect(within(card).getByText('2 units')).toBeInTheDocument();
    // Names start with what the row shows
    await user.click(within(card).getByRole('button', { name: /^\$2,395 New, Riverlight/ }));
    expect(selected).toEqual(['unit:1601']);
    await user.click(within(card).getByRole('button', { name: 'Riverlight' }));
    expect(opened).toBe(1);
    await user.click(within(card).getByRole('button', { name: 'Close Riverlight' }));
    expect(closed).toBe(1);
  });

  it('shows a larger preview beside the card for a photo row', () => {
    render(<MapCard id="b1" name="Riverlight" rows={[row('1601', '$2,395')]} photo />);
    const rowBtn = screen.getByRole('button', { name: /^\$2,395/ });
    expect(document.querySelector('[data-preview]')).toBeNull();
    fireEvent.mouseEnter(rowBtn.querySelector('span') as Element);
    const preview = document.querySelector('[data-preview]');
    expect(preview).toHaveTextContent('Unit 1601');
    fireEvent.mouseLeave(rowBtn);
    expect(document.querySelector('[data-preview]')).toBeNull();
  });

  it('lets go of the hover when it closes under the pointer', () => {
    const hovers: (string | null)[] = [];
    const { unmount } = render(
      <MapCard
        id="b1"
        name="Riverlight"
        rows={[row('1601', '$2,395')]}
        photo={false}
        onHover={(k) => hovers.push(k)}
      />,
    );
    fireEvent.mouseEnter(screen.getByRole('button', { name: /^\$2,395/ }));
    unmount();
    expect(hovers.at(-1)).toBeNull();
  });
});
