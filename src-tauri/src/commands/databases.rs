use std::time::{Duration, Instant};

use futures_util::TryStreamExt;
use serde::Serialize;
use sqlx::mysql::{MySqlConnectOptions, MySqlPool, MySqlPoolOptions, MySqlSslMode};
use sqlx::postgres::{PgConnectOptions, PgPool, PgPoolOptions, PgSslMode};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use sqlx::{Column, Either, Row, TypeInfo, ValueRef};
use tauri::State;

use crate::domain::{
    database, DatabaseConnection, DatabaseConnectionInput, DatabaseConnectionView,
};
use crate::error::{AppError, AppResult};
use crate::repository::database_repo;
use crate::state::AppState;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const QUERY_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_QUERY_ROWS: usize = 1_000;
const MAX_SQL_BYTES: usize = 1024 * 1024;
const MAX_CELL_CHARS: usize = 10_000;

enum DatabaseOptions {
    Postgres(PgConnectOptions),
    MySql(MySqlConnectOptions),
    Sqlite(SqliteConnectOptions),
}

enum DatabasePool {
    Postgres(PgPool),
    MySql(MySqlPool),
    Sqlite(SqlitePool),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseConnectionTestResult {
    pub latency_ms: u128,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseSchemaObject {
    pub schema: String,
    pub name: String,
    pub kind: DatabaseObjectKind,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DatabaseObjectKind {
    Table,
    View,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseQueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Option<String>>>,
    pub affected_rows: Option<u64>,
    pub elapsed_ms: u128,
    pub truncated: bool,
}

fn connection_options(connection: &DatabaseConnection) -> AppResult<DatabaseOptions> {
    let options = match connection.engine.as_str() {
        database::SQLITE => {
            let path = connection
                .file_path
                .as_deref()
                .filter(|value| !value.is_empty())
                .ok_or_else(|| AppError::Invalid("SQLite database file is required".into()))?;
            DatabaseOptions::Sqlite(
                SqliteConnectOptions::new()
                    .filename(path)
                    .create_if_missing(false),
            )
        }
        database::POSTGRES => {
            let port = u16::try_from(connection.port)
                .map_err(|_| AppError::Invalid("invalid PostgreSQL port".into()))?;
            let mut options = PgConnectOptions::new()
                .host(&connection.host)
                .port(port)
                .ssl_mode(if connection.ssl != 0 {
                    PgSslMode::Require
                } else {
                    PgSslMode::Disable
                });
            if let Some(username) = connection.username.as_deref() {
                options = options.username(username);
            }
            if let Some(password) = connection.password.as_deref() {
                options = options.password(password);
            }
            if let Some(name) = connection.database.as_deref() {
                options = options.database(name);
            }
            DatabaseOptions::Postgres(options)
        }
        database::MYSQL => {
            let port = u16::try_from(connection.port)
                .map_err(|_| AppError::Invalid("invalid MySQL port".into()))?;
            let mut options = MySqlConnectOptions::new()
                .host(&connection.host)
                .port(port)
                .ssl_mode(if connection.ssl != 0 {
                    MySqlSslMode::Required
                } else {
                    MySqlSslMode::Disabled
                });
            if let Some(username) = connection.username.as_deref() {
                options = options.username(username);
            }
            if let Some(password) = connection.password.as_deref() {
                options = options.password(password);
            }
            if let Some(name) = connection.database.as_deref() {
                options = options.database(name);
            }
            DatabaseOptions::MySql(options)
        }
        engine => {
            return Err(AppError::Invalid(format!(
                "unknown database engine: {engine}"
            )));
        }
    };
    Ok(options)
}

async fn open_pool(connection: &DatabaseConnection) -> AppResult<DatabasePool> {
    Ok(match connection_options(connection)? {
        DatabaseOptions::Postgres(options) => DatabasePool::Postgres(
            PgPoolOptions::new()
                .max_connections(2)
                .acquire_timeout(CONNECT_TIMEOUT)
                .connect_with(options)
                .await?,
        ),
        DatabaseOptions::MySql(options) => DatabasePool::MySql(
            MySqlPoolOptions::new()
                .max_connections(2)
                .acquire_timeout(CONNECT_TIMEOUT)
                .connect_with(options)
                .await?,
        ),
        DatabaseOptions::Sqlite(options) => DatabasePool::Sqlite(
            SqlitePoolOptions::new()
                .max_connections(2)
                .acquire_timeout(CONNECT_TIMEOUT)
                .connect_with(options)
                .await?,
        ),
    })
}

fn limit_cell(value: String) -> String {
    value.chars().take(MAX_CELL_CHARS).collect()
}

fn blob_text(value: &[u8]) -> String {
    if value.len() <= 128 {
        format!(
            "0x{}",
            value
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
        )
    } else {
        format!("<binary {} bytes>", value.len())
    }
}

fn postgres_row_texts(row: &sqlx::postgres::PgRow) -> AppResult<Vec<Option<String>>> {
    (0..row.len())
        .map(|index| {
            let raw = row.try_get_raw(index)?;
            let value = if raw.is_null() {
                None
            } else {
                let text = raw.as_str().map_err(|error| {
                    AppError::Other(format!("failed to decode PostgreSQL value: {error}"))
                })?;
                Some(limit_cell(text.to_owned()))
            };
            Ok(value)
        })
        .collect()
}

fn mysql_binary_type(name: &str) -> bool {
    matches!(
        name,
        "BINARY"
            | "VARBINARY"
            | "TINYBLOB"
            | "BLOB"
            | "MEDIUMBLOB"
            | "LONGBLOB"
            | "BIT"
            | "GEOMETRY"
    )
}

fn mysql_row_texts(row: &sqlx::mysql::MySqlRow) -> AppResult<Vec<Option<String>>> {
    (0..row.len())
        .map(|index| {
            let raw = row.try_get_raw(index)?;
            if raw.is_null() {
                return Ok(None);
            }
            let bytes = row.try_get_unchecked::<Vec<u8>, _>(index)?;
            let value = if mysql_binary_type(raw.type_info().name()) {
                blob_text(&bytes)
            } else {
                String::from_utf8(bytes).unwrap_or_else(|error| blob_text(error.as_bytes()))
            };
            Ok(Some(limit_cell(value)))
        })
        .collect()
}

fn sqlite_row_texts(row: &sqlx::sqlite::SqliteRow) -> AppResult<Vec<Option<String>>> {
    (0..row.len())
        .map(|index| {
            let raw = row.try_get_raw(index)?;
            let value = match raw.type_info().name() {
                "NULL" => None,
                "INTEGER" => Some(row.try_get_unchecked::<i64, _>(index)?.to_string()),
                "REAL" => Some(row.try_get_unchecked::<f64, _>(index)?.to_string()),
                "BLOB" => Some(blob_text(&row.try_get_unchecked::<Vec<u8>, _>(index)?)),
                _ => Some(row.try_get_unchecked::<String, _>(index)?),
            };
            Ok(value.map(limit_cell))
        })
        .collect()
}

async fn collect_postgres_query(pool: &PgPool, sql: &str) -> AppResult<DatabaseQueryResult> {
    let started = Instant::now();
    let mut connection = pool.acquire().await?;
    let mut stream = sqlx::raw_sql(sqlx::AssertSqlSafe(sql)).fetch_many(&mut *connection);
    let mut columns = Vec::new();
    let mut rows = Vec::new();
    let mut affected_rows = 0u64;
    let mut statement_count = 0usize;
    let mut truncated = false;

    while let Some(item) = stream.try_next().await? {
        match item {
            Either::Left(result) => {
                statement_count += 1;
                affected_rows = affected_rows.saturating_add(result.rows_affected());
            }
            Either::Right(row) => {
                if rows.len() >= MAX_QUERY_ROWS {
                    truncated = true;
                    break;
                }
                if columns.is_empty() {
                    columns = row
                        .columns()
                        .iter()
                        .map(|column| column.name().to_string())
                        .collect();
                }
                rows.push(postgres_row_texts(&row)?);
            }
        }
    }

    Ok(DatabaseQueryResult {
        columns,
        elapsed_ms: started.elapsed().as_millis(),
        affected_rows: (rows.is_empty() && statement_count > 0).then_some(affected_rows),
        rows,
        truncated,
    })
}

async fn collect_mysql_query(pool: &MySqlPool, sql: &str) -> AppResult<DatabaseQueryResult> {
    let started = Instant::now();
    let mut connection = pool.acquire().await?;
    let mut stream = sqlx::raw_sql(sqlx::AssertSqlSafe(sql)).fetch_many(&mut *connection);
    let mut columns = Vec::new();
    let mut rows = Vec::new();
    let mut affected_rows = 0u64;
    let mut statement_count = 0usize;
    let mut truncated = false;

    while let Some(item) = stream.try_next().await? {
        match item {
            Either::Left(result) => {
                statement_count += 1;
                affected_rows = affected_rows.saturating_add(result.rows_affected());
            }
            Either::Right(row) => {
                if rows.len() >= MAX_QUERY_ROWS {
                    truncated = true;
                    break;
                }
                if columns.is_empty() {
                    columns = row
                        .columns()
                        .iter()
                        .map(|column| column.name().to_string())
                        .collect();
                }
                rows.push(mysql_row_texts(&row)?);
            }
        }
    }

    Ok(DatabaseQueryResult {
        columns,
        elapsed_ms: started.elapsed().as_millis(),
        affected_rows: (rows.is_empty() && statement_count > 0).then_some(affected_rows),
        rows,
        truncated,
    })
}

async fn collect_sqlite_query(pool: &SqlitePool, sql: &str) -> AppResult<DatabaseQueryResult> {
    let started = Instant::now();
    let mut connection = pool.acquire().await?;
    let mut stream = sqlx::raw_sql(sqlx::AssertSqlSafe(sql)).fetch_many(&mut *connection);
    let mut columns = Vec::new();
    let mut rows = Vec::new();
    let mut affected_rows = 0u64;
    let mut statement_count = 0usize;
    let mut truncated = false;

    while let Some(item) = stream.try_next().await? {
        match item {
            Either::Left(result) => {
                statement_count += 1;
                affected_rows = affected_rows.saturating_add(result.rows_affected());
            }
            Either::Right(row) => {
                if rows.len() >= MAX_QUERY_ROWS {
                    truncated = true;
                    break;
                }
                if columns.is_empty() {
                    columns = row
                        .columns()
                        .iter()
                        .map(|column| column.name().to_string())
                        .collect();
                }
                rows.push(sqlite_row_texts(&row)?);
            }
        }
    }

    Ok(DatabaseQueryResult {
        columns,
        elapsed_ms: started.elapsed().as_millis(),
        affected_rows: (rows.is_empty() && statement_count > 0).then_some(affected_rows),
        rows,
        truncated,
    })
}

async fn collect_query(pool: &DatabasePool, sql: &str) -> AppResult<DatabaseQueryResult> {
    match pool {
        DatabasePool::Postgres(pool) => collect_postgres_query(pool, sql).await,
        DatabasePool::MySql(pool) => collect_mysql_query(pool, sql).await,
        DatabasePool::Sqlite(pool) => collect_sqlite_query(pool, sql).await,
    }
}

async fn schema_objects(connection: &DatabaseConnection) -> AppResult<Vec<DatabaseSchemaObject>> {
    let pool = open_pool(connection).await?;
    match pool {
        DatabasePool::Postgres(pool) => {
            let rows = sqlx::query(
                "SELECT table_schema::text, table_name::text, table_type::text
                 FROM information_schema.tables
                 WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
                 ORDER BY table_schema, table_type, table_name",
            )
            .fetch_all(&pool)
            .await?;
            rows.into_iter()
                .map(|row| {
                    schema_object(
                        row.try_get(0)?,
                        row.try_get(1)?,
                        &row.try_get::<String, _>(2)?,
                    )
                })
                .collect::<Result<Vec<_>, sqlx::Error>>()
                .map_err(Into::into)
        }
        DatabasePool::MySql(pool) => {
            let rows = sqlx::query(
                "SELECT CAST(table_schema AS CHAR), CAST(table_name AS CHAR),
                        CAST(table_type AS CHAR)
                 FROM information_schema.tables
                 WHERE table_schema = DATABASE()
                 ORDER BY table_type, table_name",
            )
            .fetch_all(&pool)
            .await?;
            rows.into_iter()
                .map(|row| {
                    schema_object(
                        row.try_get(0)?,
                        row.try_get(1)?,
                        &row.try_get::<String, _>(2)?,
                    )
                })
                .collect::<Result<Vec<_>, sqlx::Error>>()
                .map_err(Into::into)
        }
        DatabasePool::Sqlite(pool) => {
            let rows = sqlx::query(
                "SELECT 'main', name,
                        CASE type WHEN 'view' THEN 'VIEW' ELSE 'BASE TABLE' END
                 FROM sqlite_master
                 WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
                 ORDER BY type, name",
            )
            .fetch_all(&pool)
            .await?;
            rows.into_iter()
                .map(|row| {
                    schema_object(
                        row.try_get(0)?,
                        row.try_get(1)?,
                        &row.try_get::<String, _>(2)?,
                    )
                })
                .collect::<Result<Vec<_>, sqlx::Error>>()
                .map_err(Into::into)
        }
    }
}

fn schema_object(
    schema: String,
    name: String,
    table_type: &str,
) -> Result<DatabaseSchemaObject, sqlx::Error> {
    let kind = if table_type.eq_ignore_ascii_case("view") {
        DatabaseObjectKind::View
    } else {
        DatabaseObjectKind::Table
    };
    Ok(DatabaseSchemaObject { schema, name, kind })
}

async fn execute_query(
    connection: &DatabaseConnection,
    sql: &str,
) -> AppResult<DatabaseQueryResult> {
    let sql = sql.trim();
    if sql.is_empty() {
        return Err(AppError::Invalid("SQL statement is required".into()));
    }
    if sql.len() > MAX_SQL_BYTES {
        return Err(AppError::Invalid(format!(
            "SQL statement exceeds {MAX_SQL_BYTES} bytes"
        )));
    }
    let pool = open_pool(connection).await?;
    match tokio::time::timeout(QUERY_TIMEOUT, collect_query(&pool, sql)).await {
        Ok(result) => result,
        Err(_) => Err(AppError::Timeout("database query timed out".into())),
    }
}

#[tauri::command]
pub async fn database_connections_list(
    state: State<'_, AppState>,
) -> AppResult<Vec<DatabaseConnectionView>> {
    Ok(database_repo::list(&state.db)
        .await?
        .into_iter()
        .map(DatabaseConnectionView::from)
        .collect())
}

#[tauri::command]
pub async fn database_connections_get(
    state: State<'_, AppState>,
    id: String,
) -> AppResult<DatabaseConnectionView> {
    Ok(database_repo::get(&state.db, &id).await?.into())
}

#[tauri::command]
pub async fn database_connections_reveal_password(
    state: State<'_, AppState>,
    id: String,
) -> AppResult<String> {
    database_repo::get(&state.db, &id)
        .await?
        .password
        .filter(|password| !password.is_empty())
        .ok_or_else(|| AppError::NotFound(format!("password for database connection {id}")))
}

#[tauri::command]
pub async fn database_connections_create(
    state: State<'_, AppState>,
    input: DatabaseConnectionInput,
) -> AppResult<DatabaseConnectionView> {
    Ok(database_repo::create(&state.db, input).await?.into())
}

#[tauri::command]
pub async fn database_connections_update(
    state: State<'_, AppState>,
    id: String,
    input: DatabaseConnectionInput,
) -> AppResult<DatabaseConnectionView> {
    Ok(database_repo::update(&state.db, &id, input).await?.into())
}

#[tauri::command]
pub async fn database_connections_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    database_repo::delete(&state.db, &id).await
}

#[tauri::command]
pub async fn database_connections_test(
    state: State<'_, AppState>,
    id: String,
) -> AppResult<DatabaseConnectionTestResult> {
    let connection = database_repo::get(&state.db, &id).await?;
    let pool = open_pool(&connection).await?;
    let started = Instant::now();
    match &pool {
        DatabasePool::Postgres(pool) => {
            sqlx::query("SELECT 1").execute(pool).await?;
        }
        DatabasePool::MySql(pool) => {
            sqlx::query("SELECT 1").execute(pool).await?;
        }
        DatabasePool::Sqlite(pool) => {
            sqlx::query("SELECT 1").execute(pool).await?;
        }
    }
    Ok(DatabaseConnectionTestResult {
        latency_ms: started.elapsed().as_millis(),
    })
}

#[tauri::command]
pub async fn database_schema_list(
    state: State<'_, AppState>,
    id: String,
) -> AppResult<Vec<DatabaseSchemaObject>> {
    let connection = database_repo::get(&state.db, &id).await?;
    schema_objects(&connection).await
}

#[tauri::command]
pub async fn database_query_execute(
    state: State<'_, AppState>,
    id: String,
    sql: String,
) -> AppResult<DatabaseQueryResult> {
    let connection = database_repo::get(&state.db, &id).await?;
    execute_query(&connection, &sql).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::database::SQLITE;

    fn sqlite_connection(path: String) -> DatabaseConnection {
        DatabaseConnection {
            id: "db".into(),
            name: "Local".into(),
            engine: SQLITE.into(),
            host: String::new(),
            port: 0,
            username: None,
            password: None,
            database: None,
            file_path: Some(path),
            ssl: 0,
            created_at: crate::domain::now(),
            updated_at: crate::domain::now(),
            deleted_at: None,
            revision: 1,
        }
    }

    #[test]
    fn formats_binary_values_for_display() {
        assert_eq!(blob_text(&[1, 2, 255]), "0x0102ff");
        assert_eq!(blob_text(&[0; 129]), "<binary 129 bytes>");
    }

    #[tokio::test]
    async fn queries_and_lists_sqlite_schema() {
        let path =
            std::env::temp_dir().join(format!("sageport-database-{}.sqlite", uuid::Uuid::new_v4()));
        SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(&path)
                    .create_if_missing(true),
            )
            .await
            .unwrap()
            .close()
            .await;
        let connection = sqlite_connection(path.to_string_lossy().into_owned());
        let setup = execute_query(
            &connection,
            "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)",
        )
        .await
        .unwrap();
        assert_eq!(setup.affected_rows, Some(0));
        execute_query(&connection, "INSERT INTO items (name) VALUES ('one')")
            .await
            .unwrap();
        let result = execute_query(&connection, "SELECT id, name FROM items")
            .await
            .unwrap();
        assert_eq!(result.columns, ["id", "name"]);
        assert_eq!(
            result.rows,
            vec![vec![Some("1".into()), Some("one".into())]]
        );

        let objects = schema_objects(&connection).await.unwrap();
        assert!(objects.iter().any(|object| object.name == "items"));
        let _ = std::fs::remove_file(path);
    }
}
