import type { Legend as LegendData } from '../../domain/pins';
import styles from './map.module.css';

/** What the pin colors mean: the rows of the legend, without a frame. */
export function LegendBody({ legend }: { legend: LegendData }) {
  if (legend.kind === 'status' || legend.kind === 'label')
    return (
      <ul className={styles.legendRows} aria-label={legend.title}>
        {legend.rows.map((r) => (
          <li key={r.label}>
            <i className={styles.swatch} style={{ background: r.color }} aria-hidden="true" />
            {r.label}
          </li>
        ))}
      </ul>
    );
  if (legend.kind === 'price')
    return (
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
    );
  return <p className={styles.range}>{legend.text}</p>;
}

/** The legend in the map corner (laptop); phones see it in the Pins panel. */
export function Legend({ legend }: { legend: LegendData }) {
  return (
    <section className={styles.legend} aria-labelledby="map-legend-title" data-reserve>
      <h3 id="map-legend-title" className={styles.legendTitle}>
        {legend.title}
      </h3>
      <LegendBody legend={legend} />
    </section>
  );
}
