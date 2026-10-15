import { appInfo, channelLabel } from '../../config';
import styles from './AppShell.module.css';

/** Shown on every build that is not the live app, so it can't be mistaken for it. */
export function PreviewBanner() {
  if (appInfo.channel === 'live') return null;
  const text =
    appInfo.channel === 'preview'
      ? `build of ${appInfo.branch}. It uses its own sample data, never your real data.`
      : 'build. It uses its own database, never your real data.';
  return (
    <div className={styles.banner} role="status">
      <strong>{channelLabel[appInfo.channel]}</strong> {text}
    </div>
  );
}
