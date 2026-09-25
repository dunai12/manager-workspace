import catalog from './generated.json';

export type ReleaseNote = { version: string; entries: { ru: string; en: string }[] };

export function compareVersions(left: string, right: string): number {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

const releases: ReleaseNote[] = catalog.releases;

export const allReleaseNotes = () => [...releases].reverse();
export const releaseNotesSince = (version: string, current: string) =>
  releases.filter(release => compareVersions(release.version, version) > 0 && compareVersions(release.version, current) <= 0).reverse();
