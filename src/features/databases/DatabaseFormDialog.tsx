import { useState } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";

import {
  Button,
  Field,
  FormBody,
  FormDialog,
  Input,
  PasswordInput,
  Select,
  SwitchField,
} from "@/components/ui";
import { useI18n } from "@/i18n";
import { ipc } from "@/lib/ipc";
import { errorMessage, toast } from "@/lib/toast";
import type {
  DatabaseConnection,
  DatabaseConnectionInput,
  DatabaseEngine,
} from "@/types/models";
import {
  useCreateDatabaseConnection,
  useUpdateDatabaseConnection,
} from "./api";
import {
  databaseConnectionInput,
  databaseFormValues,
  defaultDatabasePort,
  validateDatabaseForm,
  type DatabaseFormError,
  type DatabaseFormValues,
} from "./databaseForm";

export function DatabaseFormDialog({
  open,
  connection,
  defaultEngine = "postgres",
  onClose,
}: {
  open: boolean;
  connection: DatabaseConnection | null;
  defaultEngine?: DatabaseEngine;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      width="w-[var(--dialog-width-lg)]"
      title={
        connection ? t("databaseForm.editTitle") : t("databaseForm.newTitle")
      }
    >
      <DatabaseFormBody
        key={connection?.id ?? defaultEngine}
        connection={connection}
        defaultEngine={defaultEngine}
        onClose={onClose}
      />
    </FormDialog>
  );
}

function DatabaseFormBody({
  connection,
  defaultEngine,
  onClose,
}: {
  connection: DatabaseConnection | null;
  defaultEngine: DatabaseEngine;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const createConnection = useCreateDatabaseConnection();
  const updateConnection = useUpdateDatabaseConnection();
  const [values, setValues] = useState<DatabaseFormValues>(() => ({
    ...databaseFormValues(connection),
    engine: connection?.engine ?? defaultEngine,
    port:
      connection?.port ||
      defaultDatabasePort(connection?.engine ?? defaultEngine),
  }));
  const [passwordEdited, setPasswordEdited] = useState(false);

  const patch = (next: Partial<DatabaseFormValues>) =>
    setValues((current) => ({ ...current, ...next }));

  const changeEngine = (engine: DatabaseEngine) => {
    const previousDefault = defaultDatabasePort(values.engine);
    setValues((current) => ({
      ...current,
      engine,
      host:
        engine === "sqlite"
          ? ""
          : current.host || (current.engine === "sqlite" ? "localhost" : ""),
      port:
        engine === "sqlite"
          ? 0
          : current.port === previousDefault || current.port === 0
            ? defaultDatabasePort(engine)
            : current.port,
    }));
  };

  const revealSavedPassword = async () => {
    if (values.password) return true;
    if (!connection?.hasPassword) return true;
    try {
      patch({ password: await ipc.databases.revealPassword(connection.id) });
      setPasswordEdited(false);
      return true;
    } catch (error) {
      toast.error(t("databaseForm.passwordRevealError"), errorMessage(error));
      return false;
    }
  };

  const pickSqliteFile = async () => {
    try {
      const selected = await openFileDialog({
        title: t("databaseForm.chooseFile"),
        multiple: false,
        directory: false,
        filters: [
          {
            name: t("databaseForm.sqliteFiles"),
            extensions: ["sqlite", "sqlite3", "db"],
          },
        ],
      });
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (!path) return;
      const filename = path.split(/[\\/]/).at(-1) ?? "";
      setValues((current) => ({
        ...current,
        filePath: path,
        name: current.name || filename,
      }));
    } catch (error) {
      toast.error(t("databaseForm.chooseFileError"), errorMessage(error));
    }
  };

  const submit = async () => {
    const error = validateDatabaseForm(values);
    if (error) {
      toast.error(formErrorText(error, t));
      return;
    }
    const input: DatabaseConnectionInput = databaseConnectionInput(
      values,
      passwordEdited,
      Boolean(connection),
    );
    try {
      if (connection) {
        await updateConnection.mutateAsync({ id: connection.id, input });
      } else {
        await createConnection.mutateAsync(input);
      }
      onClose();
    } catch (error) {
      toast.error(t("databaseForm.saveError"), errorMessage(error));
    }
  };

  return (
    <FormBody
      onClose={onClose}
      onSubmit={submit}
      submitLabel={
        connection ? t("common.saveChanges") : t("databaseForm.create")
      }
      pending={createConnection.isPending || updateConnection.isPending}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("databaseForm.name")} required>
          <Input
            autoFocus
            value={values.name}
            onChange={(event) => patch({ name: event.target.value })}
            placeholder={t("databaseForm.namePlaceholder")}
          />
        </Field>
        <Field label={t("databaseForm.engine")}>
          <Select
            value={values.engine}
            onValueChange={(value) => changeEngine(value as DatabaseEngine)}
            options={[
              {
                value: "postgres",
                label: t("databases.engine.postgres"),
              },
              { value: "mysql", label: t("databases.engine.mysql") },
              { value: "sqlite", label: t("databases.engine.sqlite") },
            ]}
          />
        </Field>
      </div>

      {values.engine === "sqlite" ? (
        <Field label={t("databaseForm.file")} required>
          <div className="flex gap-2">
            <Input
              value={values.filePath}
              onChange={(event) => patch({ filePath: event.target.value })}
              placeholder={t("databaseForm.filePlaceholder")}
              className="min-w-0 flex-1"
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => void pickSqliteFile()}
            >
              <FolderOpen />
              {t("databaseForm.chooseFile")}
            </Button>
          </div>
        </Field>
      ) : (
        <>
          <div className="grid grid-cols-[1fr_7rem] gap-3">
            <Field label={t("databaseForm.host")} required>
              <Input
                value={values.host}
                onChange={(event) => patch({ host: event.target.value })}
                placeholder={t("databaseForm.hostPlaceholder")}
                spellCheck={false}
              />
            </Field>
            <Field label={t("databaseForm.port")} required>
              <Input
                type="number"
                min={1}
                max={65535}
                step={1}
                value={values.port}
                onChange={(event) =>
                  patch({ port: Number(event.target.value) })
                }
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("databaseForm.database")}>
              <Input
                value={values.database}
                onChange={(event) => patch({ database: event.target.value })}
                placeholder={t("databaseForm.databasePlaceholder")}
                spellCheck={false}
              />
            </Field>
            <Field label={t("databaseForm.username")}>
              <Input
                value={values.username}
                onChange={(event) => patch({ username: event.target.value })}
                placeholder={t("databaseForm.usernamePlaceholder")}
                autoComplete="username"
                spellCheck={false}
              />
            </Field>
          </div>

          <Field
            label={t("databaseForm.password")}
            hint={
              connection?.hasPassword
                ? t("databaseForm.passwordSavedHint")
                : undefined
            }
          >
            <PasswordInput
              value={values.password}
              onChange={(event) => {
                patch({ password: event.target.value });
                setPasswordEdited(true);
              }}
              placeholder="••••••••"
              autoComplete="new-password"
              onBeforeReveal={
                connection?.hasPassword ? revealSavedPassword : undefined
              }
            />
          </Field>

          <SwitchField
            label={t("databaseForm.ssl")}
            description={t("databaseForm.sslDescription")}
            checked={values.ssl}
            onCheckedChange={(ssl) => patch({ ssl })}
          />
        </>
      )}
    </FormBody>
  );
}

function formErrorText(
  error: DatabaseFormError,
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (error === "nameRequired") return t("databaseForm.nameRequired");
  if (error === "hostRequired") return t("databaseForm.hostRequired");
  if (error === "portInvalid") return t("databaseForm.portInvalid");
  return t("databaseForm.fileRequired");
}
