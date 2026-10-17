import { Link, NavLink, Navigate, useParams } from 'react-router-dom';
import { Notice } from '../shell/Notice';
import { PreviewBanner } from '../shell/PreviewBanner';
import { BackupSection } from './BackupSection';
import { StorageSection } from './StorageSection';
import styles from './settings.module.css';

/**
 * Settings (#/settings/:section; DESIGN.md §4.5). Sections arrive with the milestones that
 * need them: Backup and restore and Storage in M5; cost profile (M8), labels and reasons,
 * display, photo archive (M11) and keyboard shortcuts later.
 */
const SECTIONS = [
  { id: 'backup', label: 'Backup and restore', Component: BackupSection },
  { id: 'storage', label: 'Storage', Component: StorageSection },
] as const;

export function SettingsPage() {
  const { section } = useParams();
  const current = SECTIONS.find((s) => s.id === section);
  if (!current) return <Navigate to="/settings/backup" replace />;
  const { Component } = current;

  return (
    <div className={styles.page}>
      <PreviewBanner />
      <header className={styles.top}>
        <Link to="/" className={styles.back}>
          ← Back to the app
        </Link>
      </header>
      <div className={styles.layout}>
        <nav className={styles.nav} aria-label="Settings">
          <h1 className={styles.title}>Settings</h1>
          <ul className={styles.navList}>
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <NavLink to={`/settings/${s.id}`} replace className={styles.navLink}>
                  {s.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <main className={styles.main} aria-labelledby="settings-heading">
          <h2 id="settings-heading" className={styles.heading}>
            {current.label}
          </h2>
          <Component />
        </main>
      </div>
      <Notice />
    </div>
  );
}
