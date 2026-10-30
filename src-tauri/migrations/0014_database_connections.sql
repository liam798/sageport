CREATE TABLE database_connections (
  id         TEXT PRIMARY KEY NOT NULL,
  name       TEXT NOT NULL,
  engine     TEXT NOT NULL,
  host       TEXT NOT NULL DEFAULT '',
  port       INTEGER NOT NULL DEFAULT 0,
  username   TEXT,
  password   TEXT,
  database   TEXT,
  file_path  TEXT,
  ssl        INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  revision   INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_database_connections_updated
  ON database_connections (updated_at);
