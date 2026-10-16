import { Link } from 'react-router-dom';
import { appInfo, channelLabel, dbName } from '../../config';
import styles from './AppShell.module.css';

/** Small line saying which build this is and which database it uses. */
export function BuildInfo() {
  const line = `${channelLabel[appInfo.channel]} build · v${appInfo.version} · ${appInfo.commit}`;
  return (
    <p className={styles.buildInfo} data-testid="build-info">
      {line}
      <br />
      Database: <code>{dbName}</code> · <Link to="/debug">Data check</Link>
    </p>
  );
}
