use sqlx::SqlitePool;

use crate::domain::{new_id, now};
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct AiSessionRow {
    pub id: String,
    pub title: String,
    pub messages: String,
    pub approval_mode: String,
    pub execution_target: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct AiSessionMetadataRow {
    pub id: String,
    pub title: String,
    pub execution_target: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

pub async fn list(pool: &SqlitePool) -> AppResult<Vec<AiSessionMetadataRow>> {
    let rows = sqlx::query_as::<_, AiSessionMetadataRow>(
        "SELECT id, title, execution_target, created_at, updated_at FROM ai_sessions ORDER BY updated_at DESC",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn get(pool: &SqlitePool, id: &str) -> AppResult<AiSessionRow> {
    sqlx::query_as::<_, AiSessionRow>(
        "SELECT id, title, messages, approval_mode, execution_target, created_at, updated_at FROM ai_sessions WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("ai session {id}")))
}

pub async fn create(
    pool: &SqlitePool,
    approval_mode: &str,
    execution_target: Option<&str>,
) -> AppResult<AiSessionRow> {
    let id = new_id();
    let ts = now();
    sqlx::query(
        "INSERT INTO ai_sessions
            (id, title, messages, approval_mode, execution_target, created_at, updated_at)
         VALUES (?, '', '[]', ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(approval_mode)
    .bind(execution_target)
    .bind(&ts)
    .bind(&ts)
    .execute(pool)
    .await?;
    get(pool, &id).await
}

pub async fn set_approval_mode(pool: &SqlitePool, id: &str, approval_mode: &str) -> AppResult<()> {
    let affected = sqlx::query("UPDATE ai_sessions SET approval_mode = ? WHERE id = ?")
        .bind(approval_mode)
        .bind(id)
        .execute(pool)
        .await?
        .rows_affected();
    if affected == 0 {
        return Err(AppError::NotFound(format!("ai session {id}")));
    }
    Ok(())
}

pub async fn save(
    pool: &SqlitePool,
    id: &str,
    messages_json: &str,
    title: Option<&str>,
) -> AppResult<AiSessionMetadataRow> {
    let ts = now();
    let affected = if let Some(title) = title {
        sqlx::query("UPDATE ai_sessions SET messages = ?, title = ?, updated_at = ? WHERE id = ?")
            .bind(messages_json)
            .bind(title)
            .bind(&ts)
            .bind(id)
            .execute(pool)
            .await?
            .rows_affected()
    } else {
        sqlx::query("UPDATE ai_sessions SET messages = ?, updated_at = ? WHERE id = ?")
            .bind(messages_json)
            .bind(&ts)
            .bind(id)
            .execute(pool)
            .await?
            .rows_affected()
    };
    if affected == 0 {
        return Err(AppError::NotFound(format!("ai session {id}")));
    }
    sqlx::query_as::<_, AiSessionMetadataRow>(
        "SELECT id, title, execution_target, created_at, updated_at FROM ai_sessions WHERE id = ?",
    )
    .bind(id)
    .fetch_one(pool)
    .await
    .map_err(AppError::from)
}

pub async fn delete(pool: &SqlitePool, id: &str) -> AppResult<()> {
    let affected = sqlx::query("DELETE FROM ai_sessions WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?
        .rows_affected();
    if affected == 0 {
        return Err(AppError::NotFound(format!("ai session {id}")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use sqlx::sqlite::SqlitePoolOptions;

    use super::*;

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn persists_session_settings_per_conversation() {
        let pool = test_pool().await;
        let first_target =
            r#"{"kind":"database","id":"db-1","label":"Orders","detail":"PostgreSQL"}"#;
        let first = create(&pool, "request", Some(first_target)).await.unwrap();
        let second = create(&pool, "full", None).await.unwrap();

        set_approval_mode(&pool, &first.id, "assistant")
            .await
            .unwrap();

        assert_eq!(
            get(&pool, &first.id).await.unwrap().approval_mode,
            "assistant"
        );
        assert_eq!(get(&pool, &second.id).await.unwrap().approval_mode, "full");
        assert_eq!(
            get(&pool, &first.id).await.unwrap().execution_target,
            Some(first_target.to_string())
        );
        assert_eq!(get(&pool, &second.id).await.unwrap().execution_target, None);
    }
}
