import { useEffect, useRef, useState } from "react";
import {
  CircleAlert,
  Database,
  Eye,
  Play,
  RefreshCw,
  Rows3,
  Table2,
} from "lucide-react";

import {
  Badge,
  Button,
  EmptyState,
  ScrollArea,
  Spinner,
  Tooltip,
} from "@/components/ui";
import { useI18n } from "@/i18n";
import { errorMessage } from "@/lib/toast";
import { monoFontFamily, useFontStore } from "@/workbench/font";
import type { DatabaseTab } from "@/workbench/tabs";
import { useZoomStore, zoomFactor } from "@/workbench/zoom";
import { applyEditorTheme, monaco } from "@/features/sftp/monaco";
import { useTheme } from "@/themes";
import type { DatabaseQueryResult, DatabaseSchemaObject } from "@/types/models";
import {
  useDatabaseConnections,
  useDatabaseSchema,
  useExecuteDatabaseQuery,
} from "./api";
import { databaseDisplayName, previewQuery } from "./databaseQuery";

const FONT_BASE = 13;

export function DatabaseWorkspace({ tab }: { tab: DatabaseTab }) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const { data: connections = [] } = useDatabaseConnections();
  const connection = connections.find((item) => item.id === tab.connectionId);
  const engine = connection?.engine ?? "postgres";
  const databaseName = databaseDisplayName(connection, tab.title);
  const schema = useDatabaseSchema(tab.connectionId);
  const execute = useExecuteDatabaseQuery();
  const editorHostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<ReturnType<typeof monaco.editor.create> | null>(
    null,
  );
  const executeCurrentRef = useRef<() => Promise<void>>(async () => {});
  const [result, setResult] = useState<DatabaseQueryResult | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);

  useEffect(() => {
    applyEditorTheme(theme);
  }, [theme]);

  useEffect(() => {
    const model = monaco.editor.createModel(
      "",
      "sql",
      monaco.Uri.from({
        scheme: "inmemory",
        path: `/database/${tab.id}/query.sql`,
      }),
    );
    const editor = monaco.editor.create(editorHostRef.current!, {
      model,
      fontFamily: monoFontFamily(),
      fontSize: Math.round(
        FONT_BASE * zoomFactor(useZoomStore.getState().level),
      ),
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: "on",
      fixedOverflowWidgets: true,
      padding: { top: 8, bottom: 8 },
    });
    editorRef.current = editor;
    editor.setValue("SELECT 1;");
    editor.focus();

    const runAction = editor.addAction({
      id: "database.runQuery",
      label: t("databaseWorkspace.run"),
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => void executeCurrentRef.current(),
    });
    const unsubscribeZoom = useZoomStore.subscribe((state) => {
      editor.updateOptions({
        fontSize: Math.round(FONT_BASE * zoomFactor(state.level)),
      });
    });
    const unsubscribeFont = useFontStore.subscribe((state) => {
      editor.updateOptions({ fontFamily: monoFontFamily(state.family) });
    });

    return () => {
      runAction.dispose();
      unsubscribeFont();
      unsubscribeZoom();
      editorRef.current = null;
      editor.dispose();
      model.dispose();
    };
  }, [t, tab.id]);

  const executeCurrent = async () => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) return;
    const selection = editor.getSelection();
    const selected =
      selection && !selection.isEmpty()
        ? model.getValueInRange(selection).trim()
        : "";
    const sql = selected || model.getValue().trim();
    if (!sql) return;
    setQueryError(null);
    setResult(null);
    try {
      setResult(await execute.mutateAsync({ id: tab.connectionId, sql }));
    } catch (error) {
      setQueryError(errorMessage(error));
    }
  };

  useEffect(() => {
    executeCurrentRef.current = executeCurrent;
  });

  const openObject = (object: DatabaseSchemaObject) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.setValue(previewQuery(object, engine));
    editor.focus();
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-[var(--compact-toolbar-height)] shrink-0 items-center gap-2 border-b border-border-subtle bg-surface px-3">
        <Database className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {tab.title}
        </span>
        {connection && (
          <Badge className="shrink-0 px-1.5 py-0 text-[10px] uppercase">
            {t(`databases.engine.${connection.engine}`)}
          </Badge>
        )}
        <Button
          size="sm"
          onClick={() => void executeCurrentRef.current()}
          loading={execute.isPending}
        >
          <Play />
          {t("databaseWorkspace.run")}
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-52 shrink-0 flex-col border-r border-border-subtle bg-surface-sunken">
          <div className="flex h-[var(--control-height)] shrink-0 items-center gap-1 border-b border-border-subtle pl-3 pr-1">
            <span
              className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground"
              title={databaseName}
            >
              {databaseName}
            </span>
            <Tooltip content={t("databaseWorkspace.refresh")}>
              <Button
                size="icon"
                variant="ghost"
                className="size-7"
                aria-label={t("databaseWorkspace.refresh")}
                onClick={() => void schema.refetch()}
                disabled={schema.isFetching}
              >
                <RefreshCw
                  className={`size-3.5 ${schema.isFetching ? "animate-spin" : ""}`}
                />
              </Button>
            </Tooltip>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            {schema.isLoading ? (
              <div className="flex justify-center p-4">
                <Spinner />
              </div>
            ) : schema.isError ? (
              <div className="space-y-2 p-3 text-xs text-muted-foreground">
                <p>{t("databaseWorkspace.schemaError")}</p>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void schema.refetch()}
                >
                  {t("common.retry")}
                </Button>
              </div>
            ) : schema.data?.length ? (
              <div className="space-y-0.5 p-1">
                {schema.data.map((object) => (
                  <button
                    key={`${object.schema}.${object.name}.${object.kind}`}
                    type="button"
                    title={t("databaseWorkspace.previewQuery")}
                    onClick={() => openObject(object)}
                    className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-list-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
                  >
                    {object.kind === "view" ? (
                      <Eye className="size-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <Table2 className="size-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0 flex-1 truncate">
                      {object.name}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="p-3 text-xs text-muted-foreground">
                {t("databaseWorkspace.noObjects")}
              </p>
            )}
          </ScrollArea>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div
            ref={editorHostRef}
            aria-label={t("databaseWorkspace.editorLabel")}
            className="min-h-0 flex-1 border-b border-border-subtle"
          />
          <section className="flex min-h-0 flex-[0.9] flex-col bg-surface">
            <div className="flex h-[var(--control-height)] shrink-0 items-center gap-2 border-b border-border-subtle px-3 text-xs text-muted-foreground">
              <Rows3 className="size-3.5" />
              <span>{t("databaseWorkspace.results")}</span>
              {result && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>
                    {t("databaseWorkspace.rowCount", {
                      count: result.rows.length,
                    })}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {t("databaseWorkspace.elapsed", {
                      ms: result.elapsedMs,
                    })}
                  </span>
                  {result.affectedRows !== null && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>
                        {t("databaseWorkspace.affectedRows", {
                          count: result.affectedRows,
                        })}
                      </span>
                    </>
                  )}
                </>
              )}
            </div>
            <div className="min-h-0 flex-1">
              {execute.isPending ? (
                <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
                  <Spinner />
                  {t("databaseWorkspace.executing")}
                </div>
              ) : queryError ? (
                <div className="flex h-full items-start gap-2 overflow-auto p-4 text-sm text-danger">
                  <CircleAlert className="mt-0.5 size-4 shrink-0" />
                  <pre className="min-w-0 whitespace-pre-wrap font-mono text-xs">
                    {queryError}
                  </pre>
                </div>
              ) : result ? (
                result.columns.length > 0 ? (
                  <ResultTable result={result} />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center">
                    <p className="text-sm font-medium text-foreground">
                      {t("databaseWorkspace.completed")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("databaseWorkspace.affectedRows", {
                        count: result.affectedRows ?? 0,
                      })}
                    </p>
                  </div>
                )
              ) : (
                <EmptyState
                  icon={Rows3}
                  title={t("databaseWorkspace.empty.title")}
                  description={t("databaseWorkspace.empty.description")}
                  fill
                />
              )}
            </div>
            {result?.truncated && (
              <p className="border-t border-border-subtle bg-surface-sunken px-3 py-1.5 text-xs text-muted-foreground">
                {t("databaseWorkspace.truncated")}
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function ResultTable({ result }: { result: DatabaseQueryResult }) {
  return (
    <div className="h-full overflow-auto">
      <table className="w-max min-w-full border-collapse text-xs">
        <thead className="sticky top-0 z-10 bg-surface-sunken text-left">
          <tr>
            {result.columns.map((column, index) => (
              <th
                key={`${column}.${index}`}
                className="border-b border-r border-border-subtle px-2.5 py-1.5 font-medium text-muted-foreground"
              >
                {column || `#${index + 1}`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="hover:bg-list-hover">
              {result.columns.map((_, columnIndex) => {
                const value = row[columnIndex];
                return (
                  <td
                    key={columnIndex}
                    className="max-w-[36rem] whitespace-pre border-b border-r border-border-subtle px-2.5 py-1.5 align-top font-mono text-foreground"
                  >
                    {value === null ? (
                      <span className="italic text-muted-foreground">NULL</span>
                    ) : (
                      value
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
