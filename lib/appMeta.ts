import packageJson from '../package.json';

/** App semver that last wrote local / exported data. Bump with package.json. */
export const APP_VERSION: string = packageJson.version;

/**
 * Saved-data / backup envelope schema.
 * Bump when export shape or IndexedDB migration rules change.
 * (Separate from TrainerProfile.version, which is the profile document shape.)
 */
export const SCHEMA_VERSION = 1;

export interface DataMeta {
  appVersion: string;
  schemaVersion: number;
  updatedAt: string;
}

export interface SavedDataEnvelope {
  appVersion: string;
  schemaVersion: number;
  exportedAt: string;
}

export function currentDataMeta(now = new Date()): DataMeta {
  return {
    appVersion: APP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    updatedAt: now.toISOString(),
  };
}

export function currentExportMeta(now = new Date()): SavedDataEnvelope {
  return {
    appVersion: APP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now.toISOString(),
  };
}
