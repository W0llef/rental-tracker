import { useState } from 'react';
import { BuildInfo } from './BuildInfo';
import { PreviewBanner } from './PreviewBanner';
import styles from './AppShell.module.css';

type Tab = 'list' | 'map' | 'unit';

const tabs: { id: Tab; label: string }[] = [
  { id: 'list', label: 'List' },
  { id: 'map', label: 'Map' },
  { id: 'unit', label: 'Unit' },
];

/**
 * The empty app shell (DESIGN.md §3):
 *  - laptop and tablet: list column + map (the detail column joins when a unit is selected)
 *  - phone (< 760 px): bottom tabs List · Map · Unit
 * Nothing is selectable yet; real content arrives in later milestones.
 */
export function AppShell() {
  const [tab, setTab] = useState<Tab>('list');

  return (
    <div className={styles.app} data-tab={tab}>
      <PreviewBanner />
      <header className={styles.top}>
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">
            <svg viewBox="0 0 16 16">
              <rect x="2" y="3" width="12" height="7" rx="1.5" fill="var(--on-river)" />
              <path d="M6 10 L8 13 L10 10Z" fill="var(--on-river)" />
            </svg>
          </span>
          <h1 className={styles.title}>Rental Unit Tracker</h1>
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.list} aria-labelledby="list-heading" data-panel="list">
          <div className={styles.panelHead}>
            <h2 id="list-heading" className={styles.panelTitle}>
              Units
            </h2>
          </div>
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>No units yet</p>
            <p className={styles.emptyText}>
              This is the empty app shell. Adding units comes in a later step.
            </p>
          </div>
          <BuildInfo />
        </section>

        <section className={styles.detail} aria-labelledby="unit-heading" data-panel="unit">
          <div className={styles.panelHead}>
            <h2 id="unit-heading" className={styles.panelTitle}>
              Unit
            </h2>
          </div>
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>Nothing selected</p>
            <p className={styles.emptyText}>Select a unit to see its details here.</p>
          </div>
        </section>

        <section className={styles.map} aria-labelledby="map-heading" data-panel="map">
          <h2 id="map-heading" className={styles.visuallyHidden}>
            Map
          </h2>
          <div className={styles.mapPlaceholder}>
            <p className={styles.mapNote}>The map arrives in a later step.</p>
          </div>
        </section>
      </main>

      <nav className={styles.tabs} aria-label="Views">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={styles.tab}
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
