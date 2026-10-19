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
  standalone = false,
}: {
  unit: Unit;
  building: Building;
  settings: Settings;
  /** A standalone home (Q30): its own facts are edited in the unit's form. */
  standalone?: boolean;
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
      ) : e.missing.length === 0 ? null : (
        <ul className={styles.prompts} aria-label="Missing essentials">
          {e.missing.map((c) => (
            <li key={c.key}>
              <Link
                to={checkHref(c, { unitId: unit.id, buildingId: building.id, standalone })}
                state={{ inApp: true }}
                className={styles.prompt}
              >
                Add {c.label.charAt(0).toLowerCase() + c.label.slice(1)}
                {c.owner === 'building' && !standalone && (
                  <span className={styles.visuallyHidden}> (building)</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {e.unknown.length > 0 && (
        <p className={styles.muted}>
          Checked and unknown: {e.unknown.map((c) => c.label.toLowerCase()).join(', ')}.
        </p>
      )}
    </section>
  );
}
