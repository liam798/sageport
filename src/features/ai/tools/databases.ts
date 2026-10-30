import { Database, ListTree, Play } from "lucide-react";

import { databaseDisplayName } from "@/features/databases/databaseQuery";
import { ipc } from "@/lib/ipc";
import {
  str,
  toolFailure,
  toolSuccess,
  type AiTool,
  type ToolExecutionContext,
  type ToolExecutionResult,
} from "./types";

function missingConnectionError(): ToolExecutionResult {
  return toolFailure(
    "Error: no database connection is selected. Call list_database_connections and choose an explicit connectionId.",
  );
}

async function listConnections(): Promise<ToolExecutionResult> {
  const connections = await ipc.databases.list();
  if (connections.length === 0) {
    return toolSuccess(
      "No saved database connections yet. The user can add one in the Databases view.",
    );
  }
  return toolSuccess(
    JSON.stringify(
      connections.map((connection) => ({
        id: connection.id,
        name: connection.name,
        displayName: databaseDisplayName(connection, connection.name),
        engine: connection.engine,
        host: connection.engine === "sqlite" ? undefined : connection.host,
        port: connection.engine === "sqlite" ? undefined : connection.port,
        username: connection.username ?? undefined,
        database: connection.database ?? undefined,
        filePath: connection.filePath ?? undefined,
      })),
    ),
  );
}

async function listSchema(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const connectionId = str(args, "connectionId");
  if (!connectionId) return missingConnectionError();
  const objects = await ipc.databases.schema(connectionId);
  return toolSuccess(JSON.stringify(objects));
}

async function executeQuery(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const connectionId = str(args, "connectionId");
  const sql = str(args, "sql").trim();
  if (!connectionId) return missingConnectionError();
  if (!sql) return toolFailure("Error: no SQL query was provided.");
  if (context.isCancelled?.()) {
    return toolFailure(
      "Error: the assistant run was stopped before the query started.",
    );
  }
  const result = await ipc.databases.execute(connectionId, sql);
  if (context.isCancelled?.()) {
    return toolFailure(
      "Error: the assistant run was stopped; the query may have completed.",
    );
  }
  return toolSuccess(JSON.stringify(result));
}

export const databaseTools: AiTool[] = [
  {
    spec: {
      name: "list_database_connections",
      description:
        "List saved database connections with ids, engines, and endpoints. Use when the requested database is not identified by the selected execution target.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    icon: Database,
    labelKey: "ai.tool.listDatabaseConnections",
    execute: listConnections,
  },
  {
    spec: {
      name: "list_database_schema",
      description:
        "List tables and views in a saved database connection. Omit connectionId to use the selected database target.",
      parameters: {
        type: "object",
        properties: {
          connectionId: {
            type: "string",
            description:
              "Database connection id from list_database_connections. Omit to use the selected database target.",
          },
        },
        additionalProperties: false,
      },
    },
    icon: ListTree,
    labelKey: "ai.tool.listDatabaseSchema",
    untrustedResult: true,
    execute: listSchema,
  },
  {
    spec: {
      name: "execute_database_query",
      description:
        "Run SQL against a saved database connection and return columns, rows, affected rows, timing, and truncation state. Omit connectionId to use the selected database target. This requires user approval.",
      parameters: {
        type: "object",
        properties: {
          connectionId: {
            type: "string",
            description:
              "Database connection id from list_database_connections. Omit to use the selected database target.",
          },
          sql: {
            type: "string",
            minLength: 1,
            maxLength: 1024 * 1024,
            description: "The SQL statement to execute.",
          },
        },
        required: ["sql"],
        additionalProperties: false,
      },
    },
    icon: Play,
    labelKey: "ai.tool.executeDatabaseQuery",
    requiresApproval: true,
    alwaysRequireApproval: true,
    untrustedResult: true,
    confirmKey: "ai.confirmDatabaseQuery",
    execute: executeQuery,
  },
];
