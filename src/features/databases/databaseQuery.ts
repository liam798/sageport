import type {
  DatabaseConnection,
  DatabaseEngine,
  DatabaseSchemaObject,
} from "@/types/models";

export function databaseDisplayName(
  connection: DatabaseConnection | undefined,
  fallback: string,
): string {
  if (!connection) return fallback;
  if (connection.database?.trim()) return connection.database.trim();
  const filename = connection.filePath
    ?.trim()
    .split(/[\\/]/)
    .filter(Boolean)
    .at(-1);
  return filename || connection.name;
}

export function quoteIdentifier(value: string, engine: DatabaseEngine): string {
  if (engine === "mysql") {
    return `\`${value.replaceAll("`", "``")}\``;
  }
  return `"${value.replaceAll('"', '""')}"`;
}

export function previewQuery(
  object: DatabaseSchemaObject,
  engine: DatabaseEngine,
): string {
  const table = `${quoteIdentifier(object.schema, engine)}.${quoteIdentifier(
    object.name,
    engine,
  )}`;
  return `SELECT *\nFROM ${table}\nLIMIT 100;`;
}
