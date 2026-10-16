import type { Legend as LegendData } from '../../domain/pins';
import styles from './map.module.css';

/** The legend in the map corner: what the pin colors mean (DESIGN.md §2.4). */
export function Legend({ legend }: { legend: LegendData }) {
  return (
    <section className={styles.legend} aria-labelledby="map-legend-title">
      <h3 id="map-legend-title" className={styles.legendTitle}>
        {legend.title}
      </h3>
      {legend.kind === 'status' || legend.kind === 'label' ? (
        <ul>
          {legend.rows.map((r) => (
            <li key={r.label}>
              <i className={styles.swatch} style={{ background: r.color }} aria-hidden="true" />
              {r.label}
            </li>
          ))}
        </ul>
      ) : legend.kind === 'price' ? (
        <>
          <div className={styles.scale} aria-hidden="true">
            {legend.steps.map((c) => (
              <i key={c} style={{ background: c }} />
            ))}
          </div>
          <p className={styles.range}>
            <span>
              <span className={styles.vh}>Lightest </span>
              {legend.min}
            </span>
            <span>
              <span className={styles.vh}>to darkest </span>
              {legend.max}
            </span>
          </p>
        </>
      ) : (
        <p className={styles.range}>{legend.text}</p>
      )}
    </section>
  );
}
