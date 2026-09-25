use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fs, path::PathBuf, sync::Mutex};
use tauri::Manager;

const SKILL_MANIFEST: &str = include_str!("../../skills/prepare-digest/skill.json");

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    mail_enabled: bool,
    todoist_enabled: bool,
    ai_provider: String,
    ai_model: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            mail_enabled: true,
            todoist_enabled: true,
            ai_provider: "fake".into(),
            ai_model: "deterministic-v1".into(),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SourceRecord {
    id: String,
    source: String,
    title: String,
    body: String,
    observed_at: String,
    task_state: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Claim {
    text: String,
    source_ids: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Proposal {
    id: String,
    title: String,
    source_ids: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskLink {
    proposal_id: String,
    task_id: String,
    title: String,
    state: String,
    #[serde(default = "default_fake_state")]
    fake_todoist_state: String,
    created_at: String,
}

fn default_fake_state() -> String {
    "active".into()
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Run {
    id: String,
    created_at: String,
    skill_version: String,
    records: Vec<SourceRecord>,
    claims: Vec<Claim>,
    proposals: Vec<Proposal>,
    context_markdown: String,
    digest_markdown: String,
    context_path: String,
    digest_path: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActionEntry {
    proposal_id: String,
    task_id: String,
    title: String,
    result: String,
    at: String,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AppState {
    settings: Settings,
    latest_run: Option<Run>,
    task_links: Vec<TaskLink>,
    action_journal: Vec<ActionEntry>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskSelection {
    proposal_id: String,
    title: String,
}

struct StoreLock(Mutex<()>);

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path)
}

fn read_state(app: &tauri::AppHandle) -> Result<AppState, String> {
    let path = data_dir(app)?.join("state.json");
    if !path.exists() {
        return Ok(AppState::default());
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    serde_json::from_slice(&bytes).map_err(|e| format!("Не удалось прочитать локальное состояние: {e}"))
}

fn atomic_write(path: &PathBuf, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("Некорректный путь")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let temp = path.with_extension(format!("tmp-{}", std::process::id()));
    fs::write(&temp, bytes).map_err(|e| e.to_string())?;
    fs::rename(&temp, path).map_err(|e| e.to_string())
}

fn write_state(app: &tauri::AppHandle, state: &AppState) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(state).map_err(|e| e.to_string())?;
    atomic_write(&data_dir(app)?.join("state.json"), &bytes)
}

fn validate_settings(settings: &Settings) -> Result<(), String> {
    if settings.ai_provider != "fake" || settings.ai_model != "deterministic-v1" {
        return Err("В этом срезе доступен только fake-провайдер без вызова модели".into());
    }
    Ok(())
}

#[tauri::command]
fn get_state(app: tauri::AppHandle, lock: tauri::State<StoreLock>) -> Result<AppState, String> {
    let _guard = lock.0.lock().map_err(|e| e.to_string())?;
    read_state(&app)
}

#[tauri::command]
fn save_settings(
    app: tauri::AppHandle,
    lock: tauri::State<StoreLock>,
    settings: Settings,
) -> Result<AppState, String> {
    validate_settings(&settings)?;
    let _guard = lock.0.lock().map_err(|e| e.to_string())?;
    let mut state = read_state(&app)?;
    state.settings = settings;
    write_state(&app, &state)?;
    Ok(state)
}

trait ReadAdapter {
    fn collect(&self, now: &str, links: &[TaskLink]) -> Vec<SourceRecord>;
}

struct FakeMail;
impl ReadAdapter for FakeMail {
    fn collect(&self, now: &str, _links: &[TaskLink]) -> Vec<SourceRecord> {
        vec![SourceRecord {
            id: "fake-mail-brief".into(),
            source: "Почта · пример".into(),
            title: "Уточнение повестки".into(),
            body: "Коллега просит подготовить краткую повестку для обсуждения этапа проекта.".into(),
            observed_at: now.into(),
            task_state: None,
        }]
    }
}

struct FakeTodoist;
impl ReadAdapter for FakeTodoist {
    fn collect(&self, now: &str, links: &[TaskLink]) -> Vec<SourceRecord> {
        let mut records = vec![
            SourceRecord {
                id: "fake-task-active".into(),
                source: "Todoist · пример".into(),
                title: "Проверить черновик плана".into(),
                body: "Синтетическая задача, уже существующая в списке.".into(),
                observed_at: now.into(),
                task_state: Some("active".into()),
            },
            SourceRecord {
                id: "fake-task-completed".into(),
                source: "Todoist · пример".into(),
                title: "Собрать вводные".into(),
                body: "Синтетическая завершённая задача; новую задачу по ней предлагать не нужно.".into(),
                observed_at: now.into(),
                task_state: Some("completed".into()),
            },
        ];
        records.extend(links.iter().map(|link| SourceRecord {
            id: link.task_id.clone(),
            source: "Todoist · пример".into(),
            title: link.title.clone(),
            body: "Синтетическая задача, созданная пользователем через шлюз действий.".into(),
            observed_at: now.into(),
            task_state: match link.fake_todoist_state.as_str() {
                "active" => Some("active".into()),
                "completed" => Some("completed".into()),
                _ => None,
            },
        }));
        records
    }
}

fn markdown_safe(value: &str) -> String {
    value.replace('\n', " ").replace('\r', " ").replace('[', "").replace(']', "")
}

fn prepare_digest(records: &[SourceRecord], links: &[TaskLink], id: String, now: String) -> Run {
    let mut claims = Vec::new();
    let mut proposals = Vec::new();
    for record in records {
        claims.push(Claim {
            text: match record.task_state.as_deref() {
                Some("active") => format!("Активная задача: {}", record.title),
                Some("completed") => format!("Завершённая задача: {}", record.title),
                _ => format!("Запрос: {}", record.title),
            },
            source_ids: vec![record.id.clone()],
        });
        if record.id == "fake-mail-brief"
            && !links.iter().any(|link| link.proposal_id == "prepare-agenda")
        {
            proposals.push(Proposal {
                id: "prepare-agenda".into(),
                title: "Подготовить краткую повестку обсуждения".into(),
                source_ids: vec![record.id.clone()],
            });
        }
    }
    let mut context_markdown = format!("# Собранный контекст\n\nЗапуск: {now}\n\n");
    for record in records {
        context_markdown.push_str(&format!(
            "## {} [{}]\n\nИсточник: {}\n\n{}\n\n",
            markdown_safe(&record.title), record.id, record.source, markdown_safe(&record.body)
        ));
    }
    let mut digest_markdown = format!("# Дайджест\n\nПодготовлен: {now}\n\n");
    if claims.is_empty() {
        digest_markdown.push_str("Нет включённых источников.\n");
    } else {
        for claim in &claims {
            digest_markdown.push_str(&format!(
                "- {} [источник: {}]\n",
                markdown_safe(&claim.text), claim.source_ids.join(", ")
            ));
        }
    }
    Run {
        id,
        created_at: now,
        skill_version: serde_json::from_str::<serde_json::Value>(SKILL_MANIFEST)
            .ok()
            .and_then(|v| v["version"].as_str().map(str::to_owned))
            .unwrap_or_else(|| "unknown".into()),
        records: records.to_vec(),
        claims,
        proposals,
        context_markdown,
        digest_markdown,
        context_path: String::new(),
        digest_path: String::new(),
    }
}

#[tauri::command]
fn collect_context(app: tauri::AppHandle, lock: tauri::State<StoreLock>) -> Result<AppState, String> {
    let _guard = lock.0.lock().map_err(|e| e.to_string())?;
    let mut state = read_state(&app)?;
    validate_settings(&state.settings)?;
    let now = Utc::now().to_rfc3339();
    let id = Utc::now().format("%Y%m%dT%H%M%S%3fZ").to_string();
    let mut records = Vec::new();
    if state.settings.mail_enabled {
        records.extend(FakeMail.collect(&now, &state.task_links));
    }
    if state.settings.todoist_enabled {
        records.extend(FakeTodoist.collect(&now, &state.task_links));
    }
    for link in &mut state.task_links {
        link.state = records.iter().find(|record| record.id == link.task_id)
            .and_then(|record| record.task_state.clone())
            .unwrap_or_else(|| "unknown".into());
    }
    let mut run = prepare_digest(&records, &state.task_links, id.clone(), now);
    let folder = data_dir(&app)?.join("runs").join(&id);
    let context_path = folder.join("context.md");
    let digest_path = folder.join("digest.md");
    atomic_write(&context_path, run.context_markdown.as_bytes())?;
    atomic_write(&digest_path, run.digest_markdown.as_bytes())?;
    run.context_path = context_path.display().to_string();
    run.digest_path = digest_path.display().to_string();
    state.latest_run = Some(run);
    write_state(&app, &state)?;
    Ok(state)
}

#[tauri::command]
fn create_tasks(
    app: tauri::AppHandle,
    lock: tauri::State<StoreLock>,
    run_id: String,
    selections: Vec<TaskSelection>,
    confirmed: bool,
) -> Result<AppState, String> {
    if !confirmed || selections.is_empty() {
        return Err("Выберите задачи и подтвердите создание".into());
    }
    let _guard = lock.0.lock().map_err(|e| e.to_string())?;
    let mut state = read_state(&app)?;
    if !state.settings.todoist_enabled {
        return Err("Источник задач выключен".into());
    }
    let run = state.latest_run.as_ref().ok_or("Сначала соберите контекст")?;
    if run.id != run_id {
        return Err("Дайджест устарел; соберите контекст снова".into());
    }
    let mut seen = HashSet::new();
    for selection in &selections {
        if !seen.insert(selection.proposal_id.clone()) {
            return Err("Повтор предложения в запросе".into());
        }
        if !run.proposals.iter().any(|p| p.id == selection.proposal_id) {
            return Err("Предложение не принадлежит текущему дайджесту".into());
        }
        if selection.title.trim().is_empty() || selection.title.len() > 300 {
            return Err("Проверьте формулировку задачи".into());
        }
    }
    apply_selections(&mut state, selections, &Utc::now().to_rfc3339());
    write_state(&app, &state)?;
    Ok(state)
}

fn apply_selections(state: &mut AppState, selections: Vec<TaskSelection>, now: &str) {
    for selection in selections {
        if let Some(link) = state.task_links.iter().find(|l| l.proposal_id == selection.proposal_id) {
            state.action_journal.push(ActionEntry {
                proposal_id: selection.proposal_id,
                task_id: link.task_id.clone(),
                title: link.title.clone(),
                result: "duplicate_skipped".into(),
                at: now.into(),
            });
            continue;
        }
        let task_id = format!("fake-{}", selection.proposal_id);
        state.task_links.push(TaskLink {
            proposal_id: selection.proposal_id.clone(),
            task_id: task_id.clone(),
            title: selection.title.clone(),
            state: "active".into(),
            fake_todoist_state: "active".into(),
            created_at: now.into(),
        });
        state.action_journal.push(ActionEntry {
            proposal_id: selection.proposal_id,
            task_id,
            title: selection.title,
            result: "created_fake".into(),
            at: now.into(),
        });
    }
}

pub fn run() {
    tauri::Builder::default()
        .manage(StoreLock(Mutex::new(())))
        .invoke_handler(tauri::generate_handler![get_state, save_settings, collect_context, create_tasks])
        .run(tauri::generate_context!())
        .expect("failed to start app");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn digest_cites_every_claim_and_suppresses_linked_proposal() {
        let records = FakeMail.collect("now", &[]);
        let first = prepare_digest(&records, &[], "run".into(), "now".into());
        assert_eq!(first.proposals.len(), 1);
        assert!(first.claims.iter().all(|c| !c.source_ids.is_empty()));
        let linked = TaskLink {
            proposal_id: "prepare-agenda".into(),
            task_id: "fake-prepare-agenda".into(),
            title: "Повестка".into(),
            state: "completed".into(),
            fake_todoist_state: "completed".into(),
            created_at: "now".into(),
        };
        let second = prepare_digest(&records, &[linked], "next".into(), "now".into());
        assert!(second.proposals.is_empty());
    }

    #[test]
    fn repeated_create_keeps_one_link_and_journals_duplicate() {
        let mut state = AppState::default();
        let selection = || TaskSelection {
            proposal_id: "prepare-agenda".into(),
            title: "Подготовить повестку".into(),
        };
        apply_selections(&mut state, vec![selection()], "now");
        apply_selections(&mut state, vec![selection()], "later");
        assert_eq!(state.task_links.len(), 1);
        assert_eq!(state.action_journal[0].result, "created_fake");
        assert_eq!(state.action_journal[1].result, "duplicate_skipped");
        state.task_links[0].fake_todoist_state = "completed".into();
        let collected = FakeTodoist.collect("later", &state.task_links);
        assert!(collected.iter().any(|r| r.id == "fake-prepare-agenda" && r.task_state.as_deref() == Some("completed")));
        let run = prepare_digest(&FakeMail.collect("later", &state.task_links), &state.task_links, "run".into(), "later".into());
        assert!(run.proposals.is_empty());
    }
}
