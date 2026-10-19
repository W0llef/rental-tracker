import { appInfo, channelLabel, dbName } from '../../config';
import styles from './AppShell.module.css';

/** Small line saying which build this is. What's stored is in Settings → Data (M7). */
export function BuildInfo() {
  const line = `${channelLabel[appInfo.channel]} build · v${appInfo.version} · ${appInfo.commit}`;
  return (
    <p className={styles.buildInfo} data-testid="build-info">
      {line}
      <br />
      Database: <code>{dbName}</code>
    </p>
  );
}
