import type {
  DatabaseConnection,
  DatabaseConnectionInput,
  DatabaseEngine,
} from "@/types/models";

export interface DatabaseFormValues {
  name: string;
  engine: DatabaseEngine;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  filePath: string;
  ssl: boolean;
}

export type DatabaseFormError =
  "nameRequired" | "hostRequired" | "portInvalid" | "fileRequired";

export function defaultDatabasePort(engine: DatabaseEngine): number {
  if (engine === "postgres") return 5432;
  if (engine === "mysql") return 3306;
  return 0;
}

export function databaseFormValues(
  connection: DatabaseConnection | null,
): DatabaseFormValues {
  return {
    name: connection?.name ?? "",
    engine: connection?.engine ?? "postgres",
    host: connection?.host ?? "localhost",
    port:
      connection?.port || defaultDatabasePort(connection?.engine ?? "postgres"),
    username: connection?.username ?? "",
    password: "",
    database: connection?.database ?? "",
    filePath: connection?.filePath ?? "",
    ssl: connection?.ssl ?? false,
  };
}

export function validateDatabaseForm(
  values: DatabaseFormValues,
): DatabaseFormError | null {
  if (!values.name.trim()) return "nameRequired";
  if (values.engine === "sqlite") {
    if (!values.filePath.trim()) return "fileRequired";
    return null;
  }
  if (!values.host.trim()) return "hostRequired";
  if (
    !Number.isInteger(values.port) ||
    values.port < 1 ||
    values.port > 65535
  ) {
    return "portInvalid";
  }
  return null;
}

export function databaseConnectionInput(
  values: DatabaseFormValues,
  passwordEdited: boolean,
  editing: boolean,
): DatabaseConnectionInput {
  const password = passwordEdited
    ? values.password || null
    : editing
      ? undefined
      : values.password || null;

  if (values.engine === "sqlite") {
    return {
      name: values.name.trim(),
      engine: values.engine,
      host: "",
      port: 0,
      username: null,
      database: null,
      filePath: values.filePath.trim(),
      ssl: false,
      ...(password === undefined ? {} : { password }),
    };
  }

  return {
    name: values.name.trim(),
    engine: values.engine,
    host: values.host.trim(),
    port: values.port,
    username: values.username.trim() || null,
    database: values.database.trim() || null,
    filePath: null,
    ssl: values.ssl,
    ...(password === undefined ? {} : { password }),
  };
}
