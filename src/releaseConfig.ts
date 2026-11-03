import rawMetadata from './data/releaseMetadata.json';

export interface ReleaseHistoryEntry {
  versionName: string;
  versionCode: number;
  releaseTag: string;
  releaseTitle: string;
  publishedAt: string;
  apkFileName: string;
  downloadUrl: string;
  releaseNotes: string[];
}

export interface LatestReleaseInfo extends ReleaseHistoryEntry {
  releaseId: number;
  assetId: number;
  apkSizeBytes: number;
  apkSha256: string;
  forceUpdate: boolean;
}

export interface ReleaseMetadataStore {
  schemaVersion: number;
  sourceRepository: string;
  minimumAndroid: string;
  minimumAndroidFull: string;
  minimumSdk: number;
  latest: LatestReleaseInfo;
  history: ReleaseHistoryEntry[];
}

export const releaseMetadata: ReleaseMetadataStore = rawMetadata;
export const latestRelease: LatestReleaseInfo = releaseMetadata.latest;
export const releaseHistory: readonly ReleaseHistoryEntry[] = releaseMetadata.history;

export function formatReleaseDate(isoDate: string): string {
  if (!isoDate) return '';
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parsed);
}
