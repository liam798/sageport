import { useMemo, useState } from "react";
import {
  Database,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  Unplug,
} from "lucide-react";

import {
  Badge,
  Button,
  ConfirmDialog,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  EmptyState,
  ErrorState,
  LoadingState,
  Tooltip,
  type ConfirmState,
} from "@/components/ui";
import { useI18n } from "@/i18n";
import { errorDescription, errorMessage, toast } from "@/lib/toast";
import type { DatabaseConnection } from "@/types/models";
import {
  PanelContent,
  PANEL_HEADER_ACTION_CLASS,
  PANEL_LIST_ACTION_CLASS,
  PANEL_LIST_CLASS,
  PANEL_LIST_ICON_CLASS,
  PANEL_LIST_ITEM_CLASS,
} from "@/workbench/PanelHeader";
import { SideBarFilter } from "@/workbench/SideBarFilter";
import { SideBarView } from "@/workbench/SideBarView";
import { useTabsStore } from "@/workbench/tabs";
import {
  useDatabaseConnections,
  useDeleteDatabaseConnection,
  useTestDatabaseConnection,
} from "./api";
import { DatabaseFormDialog } from "./DatabaseFormDialog";

export function DatabasesView() {
  const { t } = useI18n();
  const {
    data: connections = [],
    isLoading,
    isError,
    refetch,
  } = useDatabaseConnections();
  const deleteConnection = useDeleteDatabaseConnection();
  const testConnection = useTestDatabaseConnection();
  const openDatabase = useTabsStore((state) => state.openDatabase);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<{
    open: boolean;
    connection: DatabaseConnection | null;
  }>({ open: false, connection: null });
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return connections;
    return connections.filter((connection) =>
      [
        connection.name,
        connection.host,
        connection.username ?? "",
        connection.database ?? "",
        connection.filePath ?? "",
        t(`databases.engine.${connection.engine}`),
      ].some((item) => item.toLowerCase().includes(value)),
    );
  }, [connections, query, t]);

  const openConnection = (connection: DatabaseConnection) => {
    openDatabase(connection);
  };

  const test = async (connection: DatabaseConnection) => {
    setTestingId(connection.id);
    try {
      const result = await testConnection.mutateAsync(connection.id);
      toast.success(
        t("databases.testSuccess", { name: connection.name }),
        t("databases.latency", { ms: result.latencyMs }),
      );
    } catch (error) {
      toast.error(
        t("databases.testError", { name: connection.name }),
        errorMessage(error),
      );
    } finally {
      setTestingId(null);
    }
  };

  const requestDelete = (connection: DatabaseConnection) => {
    setConfirmState({
      title: t("databases.delete.title"),
      description: t("databases.delete.description", {
        name: connection.name,
      }),
      cancelLabel: t("common.cancel"),
      actions: [
        {
          label: t("databases.delete.action"),
          variant: "destructive",
          onSelect: async () => {
            try {
              await deleteConnection.mutateAsync(connection.id);
            } catch (error) {
              toast.error(t("databases.delete.error"), errorDescription(error));
            }
          },
        },
      ],
    });
  };

  return (
    <SideBarView
      title={t("databases.viewTitle")}
      actions={
        <Tooltip content={t("databases.new")}>
          <Button
            size="icon"
            variant="ghost"
            className={PANEL_HEADER_ACTION_CLASS}
            aria-label={t("databases.new")}
            onClick={() => setForm({ open: true, connection: null })}
          >
            <Plus className="size-4" />
          </Button>
        </Tooltip>
      }
      topContent={
        <SideBarFilter
          itemCount={connections.length}
          value={query}
          onChange={setQuery}
          placeholder={t("databases.filterPlaceholder")}
          threshold={6}
        />
      }
    >
      <PanelContent>
        {isLoading ? (
          <LoadingState label={t("common.loading")} fill />
        ) : isError ? (
          <ErrorState
            title={t("common.loadError")}
            retryLabel={t("common.retry")}
            onRetry={() => void refetch()}
            fill
          />
        ) : connections.length === 0 ? (
          <EmptyState
            icon={Database}
            title={t("databases.empty.title")}
            description={t("databases.empty.description")}
            fill
            action={
              <Button
                size="sm"
                onClick={() => setForm({ open: true, connection: null })}
              >
                <Plus />
                {t("databases.empty.action")}
              </Button>
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState icon={Database} title={t("databases.noMatches")} fill />
        ) : (
          <div className={PANEL_LIST_CLASS}>
            {filtered.map((connection) => (
              <ConnectionRow
                key={connection.id}
                connection={connection}
                testing={testingId === connection.id}
                onOpen={() => openConnection(connection)}
                onEdit={() => setForm({ open: true, connection })}
                onTest={() => void test(connection)}
                onDelete={() => requestDelete(connection)}
              />
            ))}
          </div>
        )}
      </PanelContent>

      <DatabaseFormDialog
        open={form.open}
        connection={form.connection}
        onClose={() => setForm((current) => ({ ...current, open: false }))}
      />
      <ConfirmDialog
        state={confirmState}
        onClose={() => setConfirmState(null)}
      />
    </SideBarView>
  );
}

function ConnectionRow({
  connection,
  testing,
  onOpen,
  onEdit,
  onTest,
  onDelete,
}: {
  connection: DatabaseConnection;
  testing: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onTest: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const details = connectionEndpoint(connection);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          className={`${PANEL_LIST_ITEM_CLASS} relative cursor-pointer`}
          onClick={onOpen}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            onOpen();
          }}
        >
          <div className={PANEL_LIST_ICON_CLASS}>
            <Database className="size-4" strokeWidth={1.7} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">
              {connection.name}
            </p>
            <div className="flex min-w-0 items-center gap-1.5">
              <Badge className="h-4 shrink-0 px-1.5 py-0 text-[9px] uppercase">
                {t(`databases.engine.${connection.engine}`)}
              </Badge>
              <p className="min-w-0 truncate text-2xs text-muted-foreground">
                {details}
              </p>
            </div>
          </div>
          <div className="panel-list-overlay-actions pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5 rounded-md bg-list-hover p-0.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
            <Tooltip content={t("databases.test")}>
              <button
                type="button"
                aria-label={t("databases.test")}
                disabled={testing}
                onClick={(event) => {
                  event.stopPropagation();
                  onTest();
                }}
                className={PANEL_LIST_ACTION_CLASS}
              >
                {testing ? (
                  <RefreshCw className="size-3.5 animate-spin" />
                ) : (
                  <Unplug className="size-3.5" />
                )}
              </button>
            </Tooltip>
            <Tooltip content={t("common.edit")}>
              <button
                type="button"
                aria-label={t("common.edit")}
                onClick={(event) => {
                  event.stopPropagation();
                  onEdit();
                }}
                className={PANEL_LIST_ACTION_CLASS}
              >
                <Pencil className="size-3.5" />
              </button>
            </Tooltip>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onOpen}>
          <Play />
          {t("databases.open")}
        </ContextMenuItem>
        <ContextMenuItem disabled={testing} onSelect={onTest}>
          <Unplug />
          {t("databases.test")}
        </ContextMenuItem>
        <ContextMenuItem onSelect={onEdit}>
          <Pencil />
          {t("common.edit")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem destructive onSelect={onDelete}>
          <Trash2 />
          {t("common.delete")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function connectionEndpoint(connection: DatabaseConnection): string {
  if (connection.engine === "sqlite") return connection.filePath ?? "";
  const user = connection.username ? `${connection.username}@` : "";
  const database = connection.database ? ` / ${connection.database}` : "";
  return `${user}${connection.host}:${connection.port}${database}`;
}
