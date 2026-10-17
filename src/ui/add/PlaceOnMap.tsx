import { buildingName } from '../../domain/format';
import type { Building } from '../../model';
import { useUi } from '../../state/ui';
import styles from '../detail/detail.module.css';

/**
 * "Place on map" for a building without a location (PLAN.md §4.3, §5.1): the next click on
 * the map sets it. Pressed again (or Esc) cancels.
 */
export function PlaceOnMapButton({ building }: { building: Building }) {
  const placing = useUi((s) => s.placing);
  const setPlacing = useUi((s) => s.setPlacing);
  const on = placing?.buildingId === building.id;
  return (
    <button
      type="button"
      className={styles.plateButton}
      aria-pressed={on}
      onClick={() =>
        setPlacing(on ? null : { buildingId: building.id, name: buildingName(building) })
      }
    >
      {on ? 'Click the map… (Esc cancels)' : 'Place on map'}
    </button>
  );
}
