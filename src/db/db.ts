import Dexie from 'dexie';
import type { Table } from 'dexie';
import { dbName } from '../config';
import type {
  Building,
  Collection,
  Destination,
  ImportBatch,
  Listing,
  NoteEntry,
  Opinion,
  Person,
  Photo,
  Settings,
  Unit,
} from '../model';
import { changeLogMiddleware } from './changeLog';
import type { ChangeEntry } from './changeLog';
import { declareVersions, versions } from './versions';
import type { Snapshot, VersionSpec } from './versions';

export interface MetaRow {
  key: string;
  value: unknown;
}

/** The app's IndexedDB database (PLAN.md §3.6). */
export class RentalDB extends Dexie {
  buildings!: Table<Building, string>;
  units!: Table<Unit, string>;
  people!: Table<Person, string>;
  opinions!: Table<Opinion, string>;
  listings!: Table<Listing, string>;
  destinations!: Table<Destination, string>;
  collections!: Table<Collection, string>;
  notes!: Table<NoteEntry, string>;
  photos!: Table<Photo, string>;
  thumbs!: Table<{ photoId: string; blob: Blob }, string>;
  originals!: Table<{ photoId: string; blob: Blob }, string>;
  imports!: Table<ImportBatch, string>;
  settings!: Table<Settings, string>;
  changeLog!: Table<ChangeEntry, number>;
  snapshots!: Table<Snapshot, number>;
  handles!: Table<{ id: string; handle: unknown }, string>;
  geocodeCache!: Table<{ key: string; at: string; value: unknown }, string>;
  travelCache!: Table<{ key: string; at: string; value: unknown }, string>;
  meta!: Table<MetaRow, string>;

  constructor(name: string, versionList: VersionSpec[] = versions) {
    super(name);
    declareVersions(this, versionList);
    this.use(changeLogMiddleware());
  }
}

/**
 * The database for this build. Its name depends on the channel (src/config.ts): only the
 * live app uses the real database; preview and development builds use a separate one.
 */
export const db = new RentalDB(dbName);
