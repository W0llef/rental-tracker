/**
 * Where this build is running and which database it must use.
 *
 *  - "live"    the approved app on GitHub Pages (main branch). Real data.
 *  - "preview" a milestone waiting for approval. Uses a separate database, so trying it
 *              can never touch real data.
 *  - "dev"     `npm run dev` on localhost. Also a separate database.
 */
export type Channel = 'live' | 'preview' | 'dev';

function toChannel(value: string): Channel {
  return value === 'live' || value === 'preview' ? value : 'dev';
}

export const appInfo = {
  version: __APP_VERSION__,
  channel: toChannel(__APP_CHANNEL__),
  commit: __APP_COMMIT__,
  branch: __APP_BRANCH__,
} as const;

/** Name of the IndexedDB database for a channel (used from M1). Only "live" is real data. */
export function databaseName(channel: Channel): string {
  return channel === 'live' ? 'rental-tracker' : 'rental-tracker-preview';
}

export const dbName = databaseName(appInfo.channel);

export const channelLabel: Record<Channel, string> = {
  live: 'Live',
  preview: 'Preview',
  dev: 'Development',
};
