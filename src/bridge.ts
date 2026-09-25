import { invoke } from '@tauri-apps/api/core';
import type { AppState, Settings, TaskSelection } from './types';

export const bridge = {
  getState: () => invoke<AppState>('get_state'),
  saveSettings: (settings: Settings) => invoke<AppState>('save_settings', { settings }),
  collectContext: () => invoke<AppState>('collect_context'),
  createTasks: (runId: string, selections: TaskSelection[]) =>
    invoke<AppState>('create_tasks', { runId, selections, confirmed: true }),
};
