import { describe, expect, it } from "vitest";

import {
  databaseDisplayName,
  previewQuery,
  quoteIdentifier,
} from "./databaseQuery";

describe("database query helpers", () => {
  it("quotes identifiers for SQLite, PostgreSQL, and MySQL", () => {
    expect(quoteIdentifier('a"b', "postgres")).toBe('"a""b"');
    expect(quoteIdentifier("a`b", "mysql")).toBe("`a``b`");
  });

  it("creates a limited preview query with a schema", () => {
    expect(
      previewQuery(
        { schema: "public", name: "users", kind: "table" },
        "postgres",
      ),
    ).toBe('SELECT *\nFROM "public"."users"\nLIMIT 100;');
  });

  it("uses the database or SQLite filename as the workspace title", () => {
    expect(
      databaseDisplayName(
        {
          id: "database",
          name: "Production",
          engine: "postgres",
          host: "localhost",
          port: 5432,
          username: "app",
          hasPassword: true,
          database: "app",
          filePath: null,
          ssl: false,
          createdAt: "2026-10-29T00:00:00Z",
          updatedAt: "2026-10-29T00:00:00Z",
          deletedAt: null,
          revision: 1,
        },
        "Fallback",
      ),
    ).toBe("app");
    expect(
      databaseDisplayName(
        {
          id: "sqlite",
          name: "Local",
          engine: "sqlite",
          host: "",
          port: 0,
          username: null,
          hasPassword: false,
          database: null,
          filePath: "/tmp/sageport.sqlite",
          ssl: false,
          createdAt: "2026-10-29T00:00:00Z",
          updatedAt: "2026-10-29T00:00:00Z",
          deletedAt: null,
          revision: 1,
        },
        "Fallback",
      ),
    ).toBe("sageport.sqlite");
  });
});
