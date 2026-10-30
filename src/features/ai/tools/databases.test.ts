import { beforeEach, describe, expect, it, vi } from "vitest";

const { list, schema, execute } = vi.hoisted(() => ({
  list: vi.fn(),
  schema: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("@/lib/ipc", () => ({
  ipc: {
    databases: {
      list,
      schema,
      execute,
    },
  },
}));

import { databaseTools } from "./databases";

function tool(name: string) {
  const found = databaseTools.find((item) => item.spec.name === name);
  if (!found?.execute) throw new Error(`missing tool: ${name}`);
  return found;
}

beforeEach(() => {
  list.mockReset();
  schema.mockReset();
  execute.mockReset();
});

describe("database tools", () => {
  it("lists saved databases without exposing passwords", async () => {
    list.mockResolvedValue([
      {
        id: "db-1",
        name: "Production",
        engine: "postgres",
        host: "db.internal",
        port: 5432,
        username: "app",
        hasPassword: true,
        database: "orders",
        filePath: null,
        ssl: true,
        createdAt: "",
        updatedAt: "",
        deletedAt: null,
        revision: 1,
      },
    ]);

    const result = await tool("list_database_connections").execute!({}, {});

    expect(result.isError).toBe(false);
    expect(result.content).toContain('"displayName":"orders"');
    expect(result.content).not.toContain("hasPassword");
  });

  it("loads schema for the selected connection", async () => {
    schema.mockResolvedValue([
      { schema: "public", name: "orders", kind: "table" },
    ]);

    const result = await tool("list_database_schema").execute!(
      { connectionId: "db-1" },
      {},
    );

    expect(schema).toHaveBeenCalledWith("db-1");
    expect(result).toEqual({
      content: '[{"schema":"public","name":"orders","kind":"table"}]',
      isError: false,
    });
  });

  it("requires approval and executes SQL against the selected connection", async () => {
    execute.mockResolvedValue({
      columns: ["value"],
      rows: [["1"]],
      affectedRows: null,
      elapsedMs: 3,
      truncated: false,
    });
    const queryTool = tool("execute_database_query");

    const result = await queryTool.execute!(
      { connectionId: "db-1", sql: "select 1" },
      {},
    );

    expect(queryTool.alwaysRequireApproval).toBe(true);
    expect(execute).toHaveBeenCalledWith("db-1", "select 1");
    expect(result.isError).toBe(false);
  });

  it("returns an actionable error without a database target", async () => {
    const result = await tool("execute_database_query").execute!(
      { sql: "select 1" },
      {},
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("list_database_connections");
    expect(execute).not.toHaveBeenCalled();
  });
});
