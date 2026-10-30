import { describe, expect, it } from "vitest";

import type { DatabaseConnection } from "@/types/models";
import {
  databaseConnectionInput,
  databaseFormValues,
  defaultDatabasePort,
  validateDatabaseForm,
} from "./databaseForm";

const connection: DatabaseConnection = {
  id: "db-1",
  name: "Production",
  engine: "postgres",
  host: "db.example.com",
  port: 5432,
  username: "app",
  hasPassword: true,
  database: "app",
  filePath: null,
  ssl: true,
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
  revision: 1,
};

describe("database form", () => {
  it("uses engine defaults and restores saved connection fields", () => {
    expect(defaultDatabasePort("postgres")).toBe(5432);
    expect(defaultDatabasePort("mysql")).toBe(3306);
    expect(defaultDatabasePort("sqlite")).toBe(0);
    expect(databaseFormValues(connection)).toMatchObject({
      name: "Production",
      engine: "postgres",
      host: "db.example.com",
      port: 5432,
      username: "app",
      database: "app",
      ssl: true,
      password: "",
    });
  });

  it("validates required server and SQLite fields", () => {
    const values = databaseFormValues(connection);
    expect(validateDatabaseForm(values)).toBeNull();
    expect(validateDatabaseForm({ ...values, name: " " })).toBe("nameRequired");
    expect(validateDatabaseForm({ ...values, host: "" })).toBe("hostRequired");
    expect(validateDatabaseForm({ ...values, port: 70000 })).toBe(
      "portInvalid",
    );
    expect(
      validateDatabaseForm({
        ...values,
        engine: "sqlite",
        filePath: "",
      }),
    ).toBe("fileRequired");
  });

  it("keeps saved passwords unless the user edits them", () => {
    const values = databaseFormValues(connection);
    expect(
      databaseConnectionInput(values, false, true).password,
    ).toBeUndefined();
    expect(databaseConnectionInput(values, true, true).password).toBeNull();
    expect(
      databaseConnectionInput({ ...values, password: "new" }, true, true)
        .password,
    ).toBe("new");
  });

  it("clears server fields for SQLite connections", () => {
    const input = databaseConnectionInput(
      {
        ...databaseFormValues(connection),
        engine: "sqlite",
        filePath: "/tmp/app.db",
      },
      false,
      false,
    );
    expect(input).toMatchObject({
      engine: "sqlite",
      host: "",
      port: 0,
      username: null,
      database: null,
      filePath: "/tmp/app.db",
      ssl: false,
    });
  });
});
