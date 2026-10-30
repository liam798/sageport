use serde::{Deserialize, Serialize};
use sqlx::FromRow;

use crate::error::{AppError, AppResult};

pub const POSTGRES: &str = "postgres";
pub const MYSQL: &str = "mysql";
pub const SQLITE: &str = "sqlite";

const MIN_PORT: i64 = 1;
const MAX_PORT: i64 = u16::MAX as i64;
const MAX_NAME_BYTES: usize = 255;
const MAX_HOST_BYTES: usize = 255;
const MAX_USERNAME_BYTES: usize = 255;
const MAX_DATABASE_BYTES: usize = 255;
const MAX_PATH_BYTES: usize = 4096;
const MAX_PASSWORD_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseConnection {
    pub id: String,
    pub name: String,
    pub engine: String,
    pub host: String,
    pub port: i64,
    pub username: Option<String>,
    pub password: Option<String>,
    pub database: Option<String>,
    pub file_path: Option<String>,
    pub ssl: i64,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    pub revision: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseConnectionView {
    pub id: String,
    pub name: String,
    pub engine: String,
    pub host: String,
    pub port: i64,
    pub username: Option<String>,
    pub has_password: bool,
    pub database: Option<String>,
    pub file_path: Option<String>,
    pub ssl: bool,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    pub revision: i64,
}

impl From<DatabaseConnection> for DatabaseConnectionView {
    fn from(connection: DatabaseConnection) -> Self {
        Self {
            id: connection.id,
            name: connection.name,
            engine: connection.engine,
            host: connection.host,
            port: connection.port,
            username: connection.username,
            has_password: connection
                .password
                .as_deref()
                .is_some_and(|value| !value.is_empty()),
            database: connection.database,
            file_path: connection.file_path,
            ssl: connection.ssl != 0,
            created_at: connection.created_at,
            updated_at: connection.updated_at,
            deleted_at: connection.deleted_at,
            revision: connection.revision,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseConnectionInput {
    pub name: String,
    pub engine: String,
    #[serde(default)]
    pub host: String,
    #[serde(default)]
    pub port: i64,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub file_path: Option<String>,
    #[serde(default)]
    pub ssl: bool,
}

fn clean_optional(value: &mut Option<String>) {
    *value = value
        .take()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
}

fn default_port(engine: &str) -> i64 {
    match engine {
        POSTGRES => 5432,
        MYSQL => 3306,
        _ => 0,
    }
}

pub(crate) fn normalize(mut input: DatabaseConnectionInput) -> AppResult<DatabaseConnectionInput> {
    input.name = input.name.trim().to_string();
    input.engine = match input.engine.trim().to_ascii_lowercase().as_str() {
        "postgres" | "postgresql" => POSTGRES.into(),
        "mysql" | "mariadb" => MYSQL.into(),
        "sqlite" | "sqlite3" => SQLITE.into(),
        engine => engine.to_owned(),
    };
    input.host = input.host.trim().to_string();
    clean_optional(&mut input.username);
    clean_optional(&mut input.database);
    clean_optional(&mut input.file_path);

    if input.name.is_empty() {
        return Err(AppError::Invalid(
            "database connection name is required".into(),
        ));
    }
    if input.name.len() > MAX_NAME_BYTES || input.name.chars().any(char::is_control) {
        return Err(AppError::Invalid(
            "invalid or oversized database connection name".into(),
        ));
    }
    if input
        .password
        .as_deref()
        .is_some_and(|value| value.len() > MAX_PASSWORD_BYTES)
    {
        return Err(AppError::Invalid(format!(
            "password exceeds {MAX_PASSWORD_BYTES} bytes"
        )));
    }

    match input.engine.as_str() {
        SQLITE => {
            if input.file_path.is_none() {
                return Err(AppError::Invalid("SQLite database file is required".into()));
            }
            input.host.clear();
            input.port = 0;
            input.username = None;
            input.password = None;
            input.database = None;
            input.ssl = false;
            if input
                .file_path
                .as_deref()
                .is_some_and(|value| value.len() > MAX_PATH_BYTES || value.contains('\0'))
            {
                return Err(AppError::Invalid(
                    "invalid or oversized SQLite database path".into(),
                ));
            }
        }
        POSTGRES | MYSQL => {
            input.file_path = None;
            if input.host.is_empty() {
                return Err(AppError::Invalid("database host is required".into()));
            }
            if input.host.len() > MAX_HOST_BYTES || input.host.chars().any(char::is_control) {
                return Err(AppError::Invalid(
                    "invalid or oversized database host".into(),
                ));
            }
            if input.port == 0 {
                input.port = default_port(&input.engine);
            }
            if !(MIN_PORT..=MAX_PORT).contains(&input.port) {
                return Err(AppError::Invalid(format!(
                    "port must be between {MIN_PORT} and {MAX_PORT}"
                )));
            }
            if input.username.as_deref().is_some_and(|value| {
                value.len() > MAX_USERNAME_BYTES || value.chars().any(char::is_control)
            }) {
                return Err(AppError::Invalid(
                    "invalid or oversized database username".into(),
                ));
            }
            if input.database.as_deref().is_some_and(|value| {
                value.len() > MAX_DATABASE_BYTES || value.chars().any(char::is_control)
            }) {
                return Err(AppError::Invalid(
                    "invalid or oversized database name".into(),
                ));
            }
        }
        _ => {
            return Err(AppError::Invalid(format!(
                "unknown database engine: {}",
                input.engine
            )));
        }
    }

    Ok(input)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn postgres() -> DatabaseConnectionInput {
        DatabaseConnectionInput {
            name: " Production ".into(),
            engine: "PostgreSQL".into(),
            host: " db.example.com ".into(),
            port: 0,
            username: Some(" app ".into()),
            password: Some("secret".into()),
            database: Some(" app ".into()),
            file_path: None,
            ssl: true,
        }
    }

    #[test]
    fn normalizes_server_connections_and_default_ports() {
        let input = normalize(postgres()).unwrap();
        assert_eq!(input.name, "Production");
        assert_eq!(input.engine, POSTGRES);
        assert_eq!(input.host, "db.example.com");
        assert_eq!(input.port, 5432);
        assert_eq!(input.username.as_deref(), Some("app"));
        assert_eq!(input.database.as_deref(), Some("app"));
    }

    #[test]
    fn normalizes_sqlite_connections_and_requires_a_file() {
        let input = DatabaseConnectionInput {
            name: "Local".into(),
            engine: SQLITE.into(),
            host: "ignored".into(),
            port: 9000,
            username: Some("ignored".into()),
            password: Some("ignored".into()),
            database: Some("ignored".into()),
            file_path: Some(" /tmp/app.db ".into()),
            ssl: true,
        };
        let normalized = normalize(input).unwrap();
        assert_eq!(normalized.host, "");
        assert_eq!(normalized.port, 0);
        assert!(normalized.username.is_none());
        assert!(normalized.password.is_none());
        assert!(!normalized.ssl);
        assert_eq!(normalized.file_path.as_deref(), Some("/tmp/app.db"));

        let mut missing = postgres();
        missing.engine = SQLITE.into();
        assert!(matches!(normalize(missing), Err(AppError::Invalid(_))));
    }

    #[test]
    fn rejects_unknown_engines_and_invalid_ports() {
        let mut input = postgres();
        input.engine = "oracle".into();
        assert!(matches!(normalize(input), Err(AppError::Invalid(_))));

        let mut input = postgres();
        input.port = 70_000;
        assert!(matches!(normalize(input), Err(AppError::Invalid(_))));
    }
}
