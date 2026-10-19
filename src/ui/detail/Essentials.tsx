import { Link } from 'react-router-dom';
import { checkHref, essentials } from '../../domain/completeness';
import type { Building, Settings, Unit } from '../../model';
import styles from './detail.module.css';

/**
 * Essentials in the unit panel (PLAN.md §5.7, research mode; Q28): how many of your
 * essential fields are known, "Ready to compare" when all are, and each missing one as a
 * one-click prompt that opens the form at that field. Shown for every unit until Shortlist
 * mode arrives (M10), which can keep it to the shortlist.
 */
export function EssentialsSection({
  unit,
  building,
  settings,
}: {
  unit: Unit;
  building: Building;
  settings: Settings;
}) {
  const e = essentials({ unit, building }, settings.essentialFields);
  if (e.total === 0) return null;
  return (
    <section className={styles.essentials} aria-labelledby="essentials-title">
      <h3 className={styles.essentialsTitle} id="essentials-title">
        {e.ready ? (
          <span className={styles.ready}>Ready to compare</span>
        ) : (
          <>
            Essentials {e.filled} of {e.total}
          </>
        )}
      </h3>
      {e.ready ? (
        <p className={styles.muted}>All {e.total} essentials are known.</p>
      ) : (
        <ul className={styles.prompts} aria-label="Missing essentials">
          {e.missing.map((c) => (
            <li key={c.key}>
              <Link
                to={checkHref(c, { unitId: unit.id, buildingId: building.id })}
                state={{ inApp: true }}
                className={styles.prompt}
              >
                Add {c.label.charAt(0).toLowerCase() + c.label.slice(1)}
                {c.owner === 'building' && (
                  <span className={styles.visuallyHidden}> (building)</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
