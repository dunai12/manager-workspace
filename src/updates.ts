import { invoke } from '@tauri-apps/api/core';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

export type ReleaseNotesState = { currentVersion: string; lastSeenVersion: string };

export const releaseNotesState = () => invoke<ReleaseNotesState>('release_notes_state');
export const markReleaseNotesSeen = () => invoke<void>('mark_release_notes_seen');
export const checkForUpdate = (): Promise<Update | null> => check({ timeout: 10_000 });
export async function installUpdate(update: Update): Promise<void> {
  await update.downloadAndInstall();
  await relaunch();
}
