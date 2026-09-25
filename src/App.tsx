import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { bridge } from './bridge';
import type { AppState, Settings, TaskSelection } from './types';
import type { Update } from '@tauri-apps/plugin-updater';
import { allReleaseNotes, releaseNotesSince, type ReleaseNote } from './release-notes';
import { checkForUpdate, installUpdate, markReleaseNotesSeen, releaseNotesState } from './updates';

type Page = 'digest' | 'sources' | 'tasks' | 'settings';

const dateText = (iso: string) => new Intl.DateTimeFormat('ru', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
const stateText = (state: string) => state === 'active' ? 'Активна' : state === 'completed' ? 'Завершена' : 'Состояние неизвестно';

function App() {
  const [appState, setAppState] = useState<AppState | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [page, setPage] = useState<Page>('digest');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState(false);
  const [update, setUpdate] = useState<Update | null>(null);
  const [dismissedUpdate, setDismissedUpdate] = useState<string | null>(() => {
    try { return localStorage.getItem('manager-workspace.dismissed-update'); } catch { return null; }
  });
  const [updating, setUpdating] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [releaseNotes, setReleaseNotes] = useState<ReleaseNote[]>([]);
  const [notesOpen, setNotesOpen] = useState(false);
  const [autoNotes, setAutoNotes] = useState(false);

  useEffect(() => {
    bridge.getState().then(state => { setAppState(state); setSettings(state.settings); })
      .catch(e => setError(String(e)));
  }, []);

  useEffect(() => {
    if (import.meta.env.DEV) return;
    let active = true;
    void releaseNotesState().then(({ currentVersion, lastSeenVersion }) => {
      if (!active) return;
      const notes = releaseNotesSince(lastSeenVersion, currentVersion);
      if (notes.length) {
        setReleaseNotes(notes);
        setAutoNotes(true);
        setNotesOpen(true);
      }
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (import.meta.env.DEV) return;
    let active = true;
    const check = () => void checkForUpdate().then(result => {
      if (active) setUpdate(result);
    }).catch(() => {});
    check();
    const timer = window.setInterval(check, 24 * 60 * 60 * 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const closeNotes = () => {
    setNotesOpen(false);
    if (autoNotes) void markReleaseNotesSeen().catch(() => {});
    setAutoNotes(false);
  };

  useEffect(() => {
    if (!notesOpen) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') closeNotes(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [notesOpen, autoNotes]);

  const checkUpdateNow = async () => {
    setCheckingUpdate(true);
    try {
      const result = await checkForUpdate();
      setUpdate(result);
      setNotice(result ? `Доступна версия ${result.version}.` : 'Установлена актуальная версия.');
    } catch {
      setError('Не удалось проверить обновления. Повторите попытку позже.');
    } finally {
      setCheckingUpdate(false);
    }
  };

  const startUpdate = async () => {
    if (!update) return;
    setUpdating(true);
    try {
      await installUpdate(update);
    } catch {
      setError('Не удалось установить обновление. Повторите попытку позже.');
      setUpdating(false);
    }
  };

  const act = async (job: () => Promise<AppState>, success: string | ((state: AppState) => string)) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const state = await job();
      setAppState(state);
      setSettings(state.settings);
      setNotice(typeof success === 'string' ? success : success(state));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const collect = () => act(async () => {
    const state = await bridge.collectContext();
    setSelected([]);
    setTitles({});
    setPreview(false);
    setPage('digest');
    return state;
  }, 'Контекст и дайджест сохранены локально.');

  const save = () => settings && act(() => bridge.saveSettings(settings), 'Настройки сохранены.');

  const create = () => {
    const run = appState?.latestRun;
    if (!run || !preview) return;
    const selections: TaskSelection[] = selected.map(proposalId => ({
      proposalId,
      title: titles[proposalId] ?? run.proposals.find(p => p.id === proposalId)?.title ?? '',
    }));
    act(async () => {
      const state = await bridge.createTasks(run.id, selections);
      setSelected([]);
      return state;
    }, state => state.actionJournal.at(-1)?.result === 'duplicate_skipped'
      ? 'Задача уже связана с предложением; повторное создание пропущено.'
      : 'Выбранные задачи созданы в fake Todoist.');
    setPreview(false);
  };

  const toggle = (id: string) => {
    setSelected(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
    setPreview(false);
  };

  const showSource = (id: string) => {
    setPage('sources');
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'center' }));
  };

  const run = appState?.latestRun;
  const nav: { id: Page; label: string; count?: number }[] = [
    { id: 'digest', label: 'Дайджест' },
    { id: 'sources', label: 'Источники', count: run?.records.length },
    { id: 'tasks', label: 'Предложения', count: run?.proposals.length },
    { id: 'settings', label: 'Настройки' },
  ];

  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-icon">◫</span><div><strong>Контекст</strong><small>менеджера</small></div></div>
      <div className="workspace-label">РАБОЧЕЕ ПРОСТРАНСТВО</div>
      <nav aria-label="Разделы">
        {nav.map(item => <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => setPage(item.id)}>
          <span>{item.label}</span>{item.count !== undefined && <em>{item.count}</em>}
        </button>)}
      </nav>
      <div className="sidebar-bottom"><span className="status-dot" /> Локальный режим · fake-данные</div>
    </aside>

    <main className="main">
      <header className="topbar"><span>Пространство менеджера</span><span className="topbar-right">Локальные данные <span className="topbar-dot">●</span></span></header>
      <div className="content">
        <div className="heading-row">
          <div><div className="eyebrow">ПЕРВЫЙ ВЕРТИКАЛЬНЫЙ СРЕЗ</div><h1>{nav.find(item => item.id === page)?.label}</h1></div>
          {page !== 'settings' && <button className="primary-button" disabled={busy || !appState} onClick={collect}>{busy ? 'Подождите…' : '↻  Собрать контекст'}</button>}
        </div>
        {error && <div className="message error" role="alert">{error}</div>}
        {notice && <div className="message success" role="status">{notice}</div>}
        {!appState && !error && <div className="card">Загрузка локального состояния…</div>}

        {appState && page === 'digest' && <>
          <div className="summary-grid">
            <div className="metric"><span>Последний сбор</span><strong>{run ? dateText(run.createdAt) : 'Ещё не запускался'}</strong></div>
            <div className="metric"><span>Записей</span><strong>{run?.records.length ?? 0}</strong></div>
            <div className="metric"><span>Утверждений с источником</span><strong>{run?.claims.length ?? 0}</strong></div>
          </div>
          {!run ? <div className="empty card"><div className="empty-icon">◇</div><h2>Начните с контекста</h2><p>Нажмите «Собрать контекст». Приложение прочитает только включённые демонстрационные источники и сохранит Markdown локально.</p></div> : <>
            <div className="section-head"><div><h2>Дайджест</h2><p>Skill prepare-digest · версия {run.skillVersion}</p></div><span className="pill">Проверяемые источники</span></div>
            <article className="card markdown"><ReactMarkdown>{run.digestMarkdown}</ReactMarkdown></article>
            {run.claims.length > 0 && <div className="claim-links"><strong>Источники утверждений</strong>{run.claims.map((claim, index) => <div key={index}><span>{claim.text}</span>{claim.sourceIds.map(id => <button key={id} onClick={() => showSource(id)}>{id} ↗</button>)}</div>)}</div>}
            <div className="path-note">Локальный файл: <code>{run.digestPath}</code></div>
            <div className="section-head"><div><h2>Нормализованный контекст</h2><p>Сохранён как Markdown рядом с дайджестом</p></div></div>
            <article className="card markdown"><ReactMarkdown>{run.contextMarkdown}</ReactMarkdown></article>
            <div className="path-note">Локальный файл: <code>{run.contextPath}</code></div>
          </>}
        </>}

        {appState && page === 'sources' && <>
          <p className="intro">Каждое утверждение дайджеста содержит ID исходной записи. Тексты ниже — исключительно синтетический пример.</p>
          {!run && <div className="card empty">Сначала соберите контекст.</div>}
          <div className="record-list">{run?.records.map(record => <article className="card record" key={record.id} id={record.id}>
            <div className="record-top"><span className="source-tag">{record.source}</span>{record.taskState && <span className={`state-tag ${record.taskState}`}>{stateText(record.taskState)}</span>}</div>
            <h2>{record.title}</h2><p>{record.body}</p><div className="record-id">{record.id} · {dateText(record.observedAt)}</div>
          </article>)}</div>
        </>}

        {appState && page === 'tasks' && <>
          <p className="intro">Отметьте предложения, при необходимости измените формулировки, затем проверьте состав перед созданием.</p>
          {!run && <div className="card empty">Сначала соберите контекст.</div>}
          {run && <>
            <div className="section-head"><div><h2>Возможные задачи</h2><p>Ничего не создаётся автоматически</p></div><span className="pill">{run.proposals.length} предложений</span></div>
            {run.proposals.length === 0 && <div className="card empty">Новых предложений нет. Уже связанные задачи повторно не предлагаются.</div>}
            {run.proposals.map(proposal => <div className="card proposal" key={proposal.id}>
              <label className="proposal-check"><input type="checkbox" checked={selected.includes(proposal.id)} onChange={() => toggle(proposal.id)} /><span>Выбрать</span></label>
              <input className="title-input" aria-label="Формулировка задачи" value={titles[proposal.id] ?? proposal.title} onChange={event => { setTitles(current => ({ ...current, [proposal.id]: event.target.value })); setPreview(false); }} />
              <div className="record-id">Основание: {proposal.sourceIds.join(', ')}</div>
            </div>)}
            {selected.length > 0 && <div className="action-panel card">
              <div><strong>Выбрано: {selected.length}</strong><p>Внешняя запись проходит через отдельный шлюз действий.</p></div>
              {!preview ? <button className="secondary-button" onClick={() => setPreview(true)}>Проверить создание</button> : <button className="primary-button" disabled={busy} onClick={create}>{busy ? 'Создание…' : 'Создать выбранные'}</button>}
            </div>}
            {preview && <div className="card preview"><h3>Предпросмотр</h3>{selected.map(id => <p key={id}>• {titles[id] ?? run.proposals.find(p => p.id === id)?.title}</p>)}<span>Получатель: fake Todoist. Повторный запрос по тем же предложениям не создаст дубликаты.</span></div>}
            {appState.taskLinks.length > 0 && <><div className="section-head"><h2>Связанные задачи</h2></div><div className="card linked-list">{appState.taskLinks.map(link => <div className="linked-row" key={link.proposalId}><div><strong>{link.title}</strong><small>{link.taskId} · предложение {link.proposalId}</small></div><span className={`state-tag ${link.state}`}>{stateText(link.state)}</span></div>)}</div></>}
            {appState.actionJournal.length > 0 && <><div className="section-head"><h2>Журнал действий</h2></div><div className="card journal">{appState.actionJournal.slice().reverse().map((entry, index) => <div key={`${entry.at}-${index}`}>{dateText(entry.at)} · {entry.title} · {entry.result === 'created_fake' ? 'создана в fake Todoist' : 'дубликат пропущен'}</div>)}</div></>}
          </>}
        </>}

        {appState && page === 'settings' && settings && <>
          <p className="intro">Пока доступны только синтетические адаптеры. Реальные учётные записи и MCP-серверы будут подключаться отдельными этапами после проверки их возможностей.</p>
          <div className="section-head"><h2>Источники для ручного сбора</h2></div>
          <div className="card settings-card">
            <label className="setting-row"><span><strong>Почта · пример</strong><small>Одна синтетическая запись для проверки дайджеста</small></span><input type="checkbox" checked={settings.mailEnabled} onChange={e => setSettings({ ...settings, mailEnabled: e.target.checked })} /></label>
            <label className="setting-row"><span><strong>Todoist · пример</strong><small>Активная и завершённая задачи на fake-данных</small></span><input type="checkbox" checked={settings.todoistEnabled} onChange={e => setSettings({ ...settings, todoistEnabled: e.target.checked })} /></label>
          </div>
          <div className="section-head"><h2>AI-провайдер</h2></div>
          <div className="card settings-card"><div className="setting-row"><span><strong>Провайдер</strong><small>Внешние модели в этом срезе не вызываются</small></span><select aria-label="AI-провайдер" value={settings.aiProvider} disabled><option value="fake">Fake</option></select></div><div className="setting-row"><span><strong>Модель</strong><small>Детерминированная логика skill</small></span><select aria-label="Модель" value={settings.aiModel} disabled><option value="deterministic-v1">deterministic-v1</option></select></div></div>
          <div className="section-head"><h2>Версия приложения</h2></div>
          <div className="card settings-card">
            {allReleaseNotes().length > 0 && <div className="setting-row"><span><strong>Что нового</strong><small>Изменения в опубликованных версиях</small></span><button className="secondary-button" onClick={() => { setReleaseNotes(allReleaseNotes()); setAutoNotes(false); setNotesOpen(true); }}>Посмотреть</button></div>}
            <div className="setting-row"><span><strong>Обновления</strong><small>Проверка доступной версии</small></span><button className="secondary-button" disabled={checkingUpdate} onClick={() => void checkUpdateNow()}>{checkingUpdate ? 'Проверка…' : 'Проверить обновления'}</button></div>
            {update && <div className="setting-row"><span><strong>Доступна версия {update.version}</strong><small>Установка начнётся после подтверждения</small></span><button className="primary-button" disabled={updating} onClick={() => void startUpdate()}>{updating ? 'Обновление…' : 'Обновить'}</button></div>}
          </div>
          <div className="settings-actions"><button className="primary-button" disabled={busy} onClick={save}>Сохранить настройки</button></div>
          <div className="future-note"><strong>Следующие этапы</strong><p>Почтовые аккаунты с разными способами подключения; Todoist MCP с проверкой истории завершений; затем произвольные MCP-серверы Jira и Confluence, выбор Telegram-чатов и новые skills.</p></div>
        </>}
      </div>
    </main>
    {update && dismissedUpdate !== update.version && <div className="update-banner" role="status"><div><strong>Доступна новая версия {update.version}</strong><p>Обновление установится только после вашего нажатия.</p></div><div className="update-actions"><button className="secondary-button" disabled={updating} onClick={() => { setDismissedUpdate(update.version); try { localStorage.setItem('manager-workspace.dismissed-update', update.version); } catch { /* dismissal still lasts for this session */ } }}>Позже</button><button className="primary-button" disabled={updating} onClick={() => void startUpdate()}>{updating ? 'Обновление…' : 'Обновить'}</button></div></div>}
    {notesOpen && releaseNotes.length > 0 && <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) closeNotes(); }}><div className="release-dialog" role="dialog" aria-modal="true" aria-label="Что нового"><h2>Что нового</h2><div className="release-dialog-content">{releaseNotes.map(release => <section key={release.version}><h3>Версия {release.version}</h3><ul>{release.entries.map((entry, index) => <li key={index}>{entry.ru}</li>)}</ul></section>)}</div><button className="primary-button" onClick={closeNotes}>Готово</button></div></div>}
  </div>;
}

export default App;
