use sqlx::SqlitePool;

use crate::domain::{database, new_id, now, DatabaseConnection, DatabaseConnectionInput};
use crate::error::{AppError, AppResult};
use crate::repository::none_if_empty;

pub async fn list(pool: &SqlitePool) -> AppResult<Vec<DatabaseConnection>> {
    let rows = sqlx::query_as::<_, DatabaseConnection>(
        "SELECT * FROM database_connections
         WHERE deleted_at IS NULL
         ORDER BY name COLLATE NOCASE",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn get(pool: &SqlitePool, id: &str) -> AppResult<DatabaseConnection> {
    sqlx::query_as::<_, DatabaseConnection>(
        "SELECT * FROM database_connections WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("database connection {id}")))
}

pub async fn create(
    pool: &SqlitePool,
    input: DatabaseConnectionInput,
) -> AppResult<DatabaseConnection> {
    let input = database::normalize(input)?;
    let id = new_id();
    let ts = now();
    let password = none_if_empty(input.password.as_deref());
    sqlx::query(
        "INSERT INTO database_connections
           (id, name, engine, host, port, username, password, database, file_path,
            ssl, created_at, updated_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)",
    )
    .bind(&id)
    .bind(&input.name)
    .bind(&input.engine)
    .bind(&input.host)
    .bind(input.port)
    .bind(&input.username)
    .bind(password)
    .bind(&input.database)
    .bind(&input.file_path)
    .bind(if input.ssl { 1 } else { 0 })
    .bind(&ts)
    .bind(&ts)
    .execute(pool)
    .await?;
    get(pool, &id).await
}

pub async fn update(
    pool: &SqlitePool,
    id: &str,
    input: DatabaseConnectionInput,
) -> AppResult<DatabaseConnection> {
    let input = database::normalize(input)?;
    let mut tx = pool.begin().await?;
    let ts = now();
    let affected = sqlx::query(
        "UPDATE database_connections SET
           name = ?, engine = ?, host = ?, port = ?, username = ?, database = ?,
           file_path = ?, ssl = ?, updated_at = ?, revision = revision + 1
         WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(&input.name)
    .bind(&input.engine)
    .bind(&input.host)
    .bind(input.port)
    .bind(&input.username)
    .bind(&input.database)
    .bind(&input.file_path)
    .bind(if input.ssl { 1 } else { 0 })
    .bind(&ts)
    .bind(id)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if affected == 0 {
        return Err(AppError::NotFound(format!("database connection {id}")));
    }
    if input.password.is_some() {
        let password = none_if_empty(input.password.as_deref());
        sqlx::query("UPDATE database_connections SET password = ? WHERE id = ?")
            .bind(password)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    let connection = sqlx::query_as::<_, DatabaseConnection>(
        "SELECT * FROM database_connections WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("database connection {id}")))?;
    tx.commit().await?;
    Ok(connection)
}

pub async fn delete(pool: &SqlitePool, id: &str) -> AppResult<()> {
    let ts = now();
    let affected = sqlx::query(
        "UPDATE database_connections
         SET deleted_at = ?, updated_at = ?, revision = revision + 1
         WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(&ts)
    .bind(&ts)
    .bind(id)
    .execute(pool)
    .await?
    .rows_affected();
    if affected == 0 {
        return Err(AppError::NotFound(format!("database connection {id}")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use sqlx::sqlite::SqlitePoolOptions;

    use super::*;
    use crate::domain::database::{MYSQL, POSTGRES};

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    fn input(engine: &str) -> DatabaseConnectionInput {
        DatabaseConnectionInput {
            name: " Production ".into(),
            engine: engine.into(),
            host: " db.example.com ".into(),
            port: 0,
            username: Some("app".into()),
            password: Some("secret".into()),
            database: Some("app".into()),
            file_path: None,
            ssl: true,
        }
    }

    #[tokio::test]
    async fn creates_lists_updates_and_deletes_connections() {
        let pool = test_pool().await;
        let created = create(&pool, input(POSTGRES)).await.unwrap();
        assert_eq!(created.name, "Production");
        assert_eq!(created.port, 5432);
        assert_eq!(created.password.as_deref(), Some("secret"));

        let listed = list(&pool).await.unwrap();
        assert_eq!(listed.len(), 1);

        let mut changed = input(MYSQL);
        changed.name = "Staging".into();
        changed.password = None;
        let updated = update(&pool, &created.id, changed).await.unwrap();
        assert_eq!(updated.name, "Staging");
        assert_eq!(updated.port, 3306);
        assert_eq!(updated.password.as_deref(), Some("secret"));

        delete(&pool, &created.id).await.unwrap();
        assert!(list(&pool).await.unwrap().is_empty());
        assert!(matches!(
            get(&pool, &created.id).await,
            Err(AppError::NotFound(_))
        ));
    }
}
