export type Settings = {
  mailEnabled: boolean;
  todoistEnabled: boolean;
  aiProvider: 'fake';
  aiModel: 'deterministic-v1';
};

export type SourceRecord = {
  id: string;
  source: string;
  title: string;
  body: string;
  observedAt: string;
  taskState: 'active' | 'completed' | null;
};

export type Claim = { text: string; sourceIds: string[] };
export type Proposal = { id: string; title: string; sourceIds: string[] };
export type TaskLink = {
  proposalId: string;
  taskId: string;
  title: string;
  state: 'active' | 'completed' | 'unknown';
  createdAt: string;
};
export type ActionEntry = {
  proposalId: string;
  taskId: string;
  title: string;
  result: 'created_fake' | 'duplicate_skipped';
  at: string;
};
export type Run = {
  id: string;
  createdAt: string;
  skillVersion: string;
  records: SourceRecord[];
  claims: Claim[];
  proposals: Proposal[];
  contextMarkdown: string;
  digestMarkdown: string;
  contextPath: string;
  digestPath: string;
};
export type AppState = {
  settings: Settings;
  latestRun: Run | null;
  taskLinks: TaskLink[];
  actionJournal: ActionEntry[];
};
export type TaskSelection = { proposalId: string; title: string };
