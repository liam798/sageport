import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronDown,
  Copy,
  Database,
  Hand,
  History,
  KeyRound,
  Loader2,
  Maximize2,
  MessageCirclePlus,
  Minimize2,
  Plus,
  Server,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Square,
  Terminal as TerminalIcon,
  Trash2,
  X,
} from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { openUrl } from "@tauri-apps/plugin-opener";

import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  EmptyState,
  INTERACTIVE_FOCUS_CLASS,
  Textarea,
  Tooltip,
} from "@/components/ui";
import { useI18n } from "@/i18n";
import { useDatabaseConnections } from "@/features/databases/api";
import { databaseDisplayName } from "@/features/databases/databaseQuery";
import { useHosts } from "@/features/hosts/api";
import { errorMessage, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useLayoutStore } from "@/workbench/layout";
import { useOverlayStore } from "@/workbench/overlays";
import {
  PanelHeader,
  PANEL_HEADER_ACTION_CLASS,
} from "@/workbench/PanelHeader";
import {
  findPane,
  targetPaneId,
  terminalPanes,
  useTabsStore,
} from "@/workbench/tabs";
import { getSession } from "@/features/terminal/sessions";
import type {
  AiApprovalMode,
  AiImageAttachment,
  AiSessionSummary,
} from "@/types/models";
import {
  IMAGE_ACCEPT,
  MAX_MESSAGE_IMAGES,
  ImageAttachmentError,
  imageDataUrl,
  imageHistoryError,
  prepareImage,
} from "./images";
import { useAiConfig, useAiModels, useSetAiModel } from "./api";
import { safeExternalUrl } from "./links";
import { shouldSubmitPrompt } from "./input";
import { useAiStore } from "./store";
import { executionTargetKey, type AiExecutionTarget } from "./execution-target";
import { MAX_AI_PROMPT_CHARS, type AgentLogItem } from "./transcript";
import {
  askUserOptions,
  askUserQuestion,
  terminalTargetDisplay,
} from "./tools";
import { resolveEnabledToolNames } from "./tools/registry";
import { QuestionPrompt, ToolActivity } from "./ToolActivity";

const EMPTY_LOG: AgentLogItem[] = [];
const STICK_TO_BOTTOM_THRESHOLD = 32;
type AssistantView = "chat" | "sessions";
type ExecutionTargetOption = AiExecutionTarget & { key: string };
const SUGGESTIONS = [
  "ai.suggestion.terminalOutput",
  "ai.suggestion.resourceUsage",
  "ai.suggestion.systemLogs",
] as const;
const APPROVAL_MODES: {
  value: AiApprovalMode;
  icon: typeof Hand;
}[] = [
  { value: "request", icon: Hand },
  { value: "assistant", icon: ShieldCheck },
  { value: "full", icon: ShieldAlert },
];

function ExecutionTargetMenuGroup({
  label,
  options,
}: {
  label: string;
  options: ExecutionTargetOption[];
}) {
  if (options.length === 0) return null;
  return (
    <div className="space-y-0.5">
      <div className="px-2 pb-1 pt-1.5 text-2xs font-medium text-muted-foreground">
        {label}
      </div>
      {options.map((option) => {
        const Icon =
          option.kind === "host"
            ? Server
            : option.kind === "database"
              ? Database
              : TerminalIcon;
        return (
          <DropdownMenuRadioItem key={option.key} value={option.key}>
            <Icon className="text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{option.label}</span>
              {option.detail && (
                <span className="block truncate text-2xs text-muted-foreground">
                  {option.detail}
                </span>
              )}
            </span>
          </DropdownMenuRadioItem>
        );
      })}
    </div>
  );
}

function ApprovalModeMenu({
  value,
  onChange,
}: {
  value: AiApprovalMode;
  onChange: (value: AiApprovalMode) => void;
}) {
  const { t } = useI18n();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={cn(
            "h-[var(--toolbar-control-size)] w-auto min-w-0 max-w-44 shrink justify-start px-2 text-xs font-normal",
            value === "full" && "text-danger hover:text-danger",
          )}
          aria-label={t("ai.approvalMode.label")}
          title={t(`ai.approvalMode.${value}.description`)}
        >
          {value === "full" ? (
            <ShieldAlert className="size-3.5 shrink-0" />
          ) : value === "assistant" ? (
            <ShieldCheck className="size-3.5 shrink-0" />
          ) : (
            <Hand className="size-3.5 shrink-0" />
          )}
          <span className="min-w-0 truncate">
            {t(`ai.approvalMode.${value}.label`)}
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-80">
        <div className="px-2 pb-1.5 pt-1">
          <div className="text-xs font-medium">
            {t("ai.approvalMode.title")}
          </div>
          <div className="mt-0.5 text-2xs leading-relaxed text-muted-foreground">
            {t("ai.approvalMode.hint")}
          </div>
        </div>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(mode) => onChange(mode as AiApprovalMode)}
        >
          {APPROVAL_MODES.map(({ value: mode, icon: Icon }) => (
            <DropdownMenuRadioItem
              key={mode}
              value={mode}
              className={cn("items-start", mode === "full" && "text-danger")}
            >
              <span className="flex min-w-0 items-start gap-2">
                <Icon className="mt-0.5 size-4 shrink-0" />
                <span className="min-w-0">
                  <span className="block text-xs font-medium">
                    {t(`ai.approvalMode.${mode}.label`)}
                  </span>
                  <span
                    className={cn(
                      "mt-0.5 block whitespace-normal text-2xs leading-relaxed",
                      mode === "full"
                        ? "text-danger/80"
                        : "text-muted-foreground",
                    )}
                  >
                    {t(`ai.approvalMode.${mode}.description`)}
                  </span>
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AssistantPanel({
  width,
  maximized = false,
  onToggleMaximized,
}: {
  width?: number;
  maximized?: boolean;
  onToggleMaximized?: () => void;
}) {
  const { locale, t } = useI18n();
  const { data: config } = useAiConfig();
  const setModel = useSetAiModel();
  const configured = Boolean(config?.baseUrl.trim());
  const {
    data: fetchedModels,
    error: modelsError,
    isLoading: modelsLoading,
  } = useAiModels(configured);
  const toggleAux = useLayoutStore((s) => s.toggleAux);
  const openSettings = useOverlayStore((s) => s.openSettings);

  const sessions = useAiStore((s) => s.sessions);
  const activeId = useAiStore((s) => s.activeId);
  const runtime = useAiStore((s) =>
    s.activeId ? s.runtime[s.activeId] : undefined,
  );
  const loadSessions = useAiStore((s) => s.loadSessions);
  const openSession = useAiStore((s) => s.openSession);
  const newSession = useAiStore((s) => s.newSession);
  const startNewChat = useAiStore((s) => s.startNewChat);
  const deleteSession = useAiStore((s) => s.deleteSession);
  const send = useAiStore((s) => s.send);
  const resume = useAiStore((s) => s.resume);
  const executionTargets = useAiStore((s) => s.executionTargets);
  const approvalModes = useAiStore((s) => s.approvalModes);
  const setApprovalMode = useAiStore((s) => s.setApprovalMode);
  const stop = useAiStore((s) => s.stop);
  const approve = useAiStore((s) => s.approve);
  const deny = useAiStore((s) => s.deny);
  const answer = useAiStore((s) => s.answer);

  const log = runtime?.log ?? EMPTY_LOG;
  const pending = runtime?.pending ?? false;
  const activity = runtime?.activity ?? null;
  const stepLimitReached = runtime?.stepLimitReached ?? false;
  const awaitingUser = log.some(
    (item) =>
      item.kind === "tool" &&
      (item.status === "awaiting-approval" || item.status === "awaiting-input"),
  );
  const toolRunning = log.some(
    (item) => item.kind === "tool" && item.status === "running",
  );
  const showThinking =
    pending && activity === "thinking" && !awaitingUser && !toolRunning;

  const [input, setInput] = useState("");
  const [view, setView] = useState<AssistantView>("chat");
  const [draftExecutionTarget, setDraftExecutionTarget] =
    useState<AiExecutionTarget | null>(null);
  const [draftApprovalMode, setDraftApprovalMode] =
    useState<AiApprovalMode | null>(null);
  const [imageDraft, setImageDraft] = useState<{
    sessionId: string | null;
    items: AiImageAttachment[];
  }>({ sessionId: null, items: [] });
  const images = imageDraft.sessionId === activeId ? imageDraft.items : [];
  const [preparingImages, setPreparingImages] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const attachmentBusy = useRef(false);
  const submitting = useRef(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deletingSession, setDeletingSession] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const logContentRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const compositionActive = useRef(false);
  const enabledToolList = resolveEnabledToolNames(config?.enabledTools);
  const defaultApprovalMode = config?.approvalMode ?? "request";
  const approvalMode = activeId
    ? (approvalModes[activeId] ?? "request")
    : (draftApprovalMode ?? defaultApprovalMode);
  const sessionLoading = Boolean(activeId && !runtime);
  const { data: hosts = [] } = useHosts();
  const { data: databases = [] } = useDatabaseConnections();
  const tabs = useTabsStore((state) => state.tabs);
  const focusPane = useTabsStore((state) => state.focusPane);
  const terminalTargetOptions: ExecutionTargetOption[] = terminalPanes(
    tabs,
  ).map((pane) => {
    const target = terminalTargetDisplay(tabs, pane.id);
    const label = target
      ? `${target.title}${target.paneIndex ? ` · ${target.paneIndex}/${target.paneCount}` : ""}`
      : pane.title;
    return {
      kind: "terminal",
      id: pane.id,
      label,
      detail: pane.target === "local" ? t("terminal.local.title") : undefined,
      key: executionTargetKey({ kind: "terminal", id: pane.id, label }),
    };
  });
  const hostTargetOptions: ExecutionTargetOption[] = hosts.map((host) => {
    const label = host.label;
    return {
      kind: "host",
      id: host.id,
      label,
      detail: `${host.username ? `${host.username}@` : ""}${host.address}:${host.port}`,
      key: executionTargetKey({ kind: "host", id: host.id, label }),
    };
  });
  const databaseTargetOptions: ExecutionTargetOption[] = databases.map(
    (connection) => {
      const label = databaseDisplayName(connection, connection.name);
      return {
        kind: "database",
        id: connection.id,
        label,
        detail:
          connection.engine === "sqlite"
            ? `${t("databases.engine.sqlite")} · ${connection.filePath ?? ""}`
            : `${t(`databases.engine.${connection.engine}`)} · ${connection.host}:${connection.port}`,
        key: executionTargetKey({ kind: "database", id: connection.id, label }),
      };
    },
  );
  const targetOptions = [
    ...hostTargetOptions,
    ...terminalTargetOptions,
    ...databaseTargetOptions,
  ];
  const executionTarget = activeId
    ? (executionTargets[activeId] ?? null)
    : draftExecutionTarget;
  const selectedTargetKey = executionTarget
    ? executionTargetKey(executionTarget)
    : "";
  const TargetIcon =
    executionTarget?.kind === "host"
      ? Server
      : executionTarget?.kind === "database"
        ? Database
        : TerminalIcon;

  const onLogScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current =
      el.scrollHeight - el.scrollTop - el.clientHeight <=
      STICK_TO_BOTTOM_THRESHOLD;
  };

  const scrollLogToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    if (configured) void loadSessions();
  }, [configured, loadSessions]);

  useEffect(() => {
    if (configured && modelsError)
      toast.error(t("ai.error"), errorMessage(modelsError));
  }, [configured, modelsError, t]);

  const models = [
    ...new Set([config?.model, ...(fetchedModels ?? [])].filter(Boolean)),
  ] as string[];

  const model = config?.model || models[0] || "";

  const changeModel = (next: string) => {
    setModel.mutate(next, {
      onError: (err) => toast.error(t("ai.error"), errorMessage(err)),
    });
  };

  const changeApprovalMode = (next: AiApprovalMode) => {
    if (next === approvalMode) return;
    if (activeId) {
      void setApprovalMode(activeId, next);
    } else {
      setDraftApprovalMode(next);
    }
  };

  const startChat = () => {
    startNewChat();
    setDraftExecutionTarget(null);
    setDraftApprovalMode(defaultApprovalMode);
    setView("chat");
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const openChat = async (id: string) => {
    await openSession(id);
    setView("chat");
  };

  useLayoutEffect(() => {
    stickToBottom.current = true;
    scrollLogToBottom();
  }, [activeId, scrollLogToBottom]);

  useLayoutEffect(() => {
    if (!stickToBottom.current) return;
    scrollLogToBottom();
  }, [log, pending, scrollLogToBottom]);

  useEffect(() => {
    const scrollArea = scrollRef.current;
    const logContent = logContentRef.current;
    if (!scrollArea || !logContent) return;
    const observer = new ResizeObserver(() => {
      if (stickToBottom.current) scrollLogToBottom();
    });
    observer.observe(scrollArea);
    observer.observe(logContent);
    return () => observer.disconnect();
  }, [configured, scrollLogToBottom]);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
    if (stickToBottom.current) scrollLogToBottom();
  }, [input, scrollLogToBottom]);

  const addImages = async (files: File[]) => {
    if (!files.length || attachmentBusy.current || sessionLoading) return;
    if (images.length + files.length > MAX_MESSAGE_IMAGES) {
      toast.error(t("ai.error"), t("ai.images.tooMany"));
      return;
    }
    attachmentBusy.current = true;
    setPreparingImages(true);
    try {
      const added: AiImageAttachment[] = [];
      for (const file of files) added.push(await prepareImage(file));
      setImageDraft((current) => ({
        sessionId: activeId,
        items: [
          ...(current.sessionId === activeId ? current.items : []),
          ...added,
        ],
      }));
    } catch (error) {
      toast.error(
        t("ai.error"),
        t(
          error instanceof ImageAttachmentError
            ? error.key
            : "ai.images.invalid",
        ),
      );
    } finally {
      attachmentBusy.current = false;
      setPreparingImages(false);
    }
  };

  const sendPrompt = async (
    prompt: string,
    attachments: AiImageAttachment[] = [],
  ): Promise<boolean> => {
    if (
      (!prompt && !attachments.length) ||
      pending ||
      !model ||
      sessionLoading ||
      attachmentBusy.current ||
      submitting.current
    )
      return false;
    const imageError = imageHistoryError(runtime?.history ?? [], attachments);
    if (imageError) {
      toast.error(t("ai.error"), t(imageError));
      return false;
    }
    if (prompt.length > MAX_AI_PROMPT_CHARS) {
      toast.error(t("ai.error"), t("ai.promptTooLong"));
      return false;
    }
    stickToBottom.current = true;
    submitting.current = true;
    try {
      const sessionId =
        activeId ?? (await newSession(approvalMode, executionTarget));
      if (!activeId) setDraftExecutionTarget(null);
      void send(
        sessionId,
        prompt,
        model,
        enabledToolList,
        config?.maxHistoryTokens,
        attachments,
      );
      return true;
    } catch (err) {
      toast.error(t("ai.error"), errorMessage(err));
      return false;
    } finally {
      submitting.current = false;
    }
  };

  const submit = async () => {
    const prompt = input.trim();
    if (!prompt && !images.length) return;
    if (await sendPrompt(prompt, images)) {
      setInput((current) => (current.trim() === prompt ? "" : current));
      setImageDraft((current) =>
        current.items === images ? { ...current, items: [] } : current,
      );
    }
  };

  const continueRun = () => {
    if (!activeId || !model || pending) return;
    stickToBottom.current = true;
    void resume(activeId, model, enabledToolList, config?.maxHistoryTokens);
  };

  const activeTitle = sessions.find((s) => s.id === activeId)?.title;

  return (
    <aside
      style={maximized ? undefined : { width }}
      className={cn(
        "flex min-w-0 flex-col overflow-hidden bg-surface",
        maximized ? "flex-1 border-l border-border-subtle" : "shrink-0",
      )}
    >
      <PanelHeader
        title={
          view === "sessions"
            ? t("ai.chatListTitle")
            : activeTitle || t("ai.viewTitle")
        }
        titleBefore={
          configured && view === "chat" ? (
            <Tooltip content={t("ai.backToChats")}>
              <Button
                size="icon"
                variant="ghost"
                className={PANEL_HEADER_ACTION_CLASS}
                aria-label={t("ai.backToChats")}
                onClick={() => setView("sessions")}
              >
                <ArrowLeft className="size-4" />
              </Button>
            </Tooltip>
          ) : undefined
        }
        titleAfter={
          activeId && executionTarget ? (
            <Tooltip
              content={`${executionTarget.label}${executionTarget.detail ? ` · ${executionTarget.detail}` : ""}`}
            >
              <span className="flex min-w-0 max-w-36 items-center gap-1 rounded-md border border-border-subtle bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground">
                <TargetIcon className="size-3 shrink-0" />
                <span className="truncate">{executionTarget.label}</span>
              </span>
            </Tooltip>
          ) : undefined
        }
        actions={
          <>
            {configured && (
              <Tooltip content={t("ai.newChat")}>
                <Button
                  size="icon"
                  variant="ghost"
                  className={PANEL_HEADER_ACTION_CLASS}
                  aria-label={t("ai.newChat")}
                  onClick={startChat}
                >
                  <MessageCirclePlus className="size-4" />
                </Button>
              </Tooltip>
            )}
            {onToggleMaximized && (
              <Tooltip
                content={
                  maximized ? t("ai.restorePanel") : t("ai.maximizePanel")
                }
              >
                <Button
                  size="icon"
                  variant="ghost"
                  className={PANEL_HEADER_ACTION_CLASS}
                  aria-label={
                    maximized ? t("ai.restorePanel") : t("ai.maximizePanel")
                  }
                  onClick={onToggleMaximized}
                >
                  {maximized ? (
                    <Minimize2 className="size-4" />
                  ) : (
                    <Maximize2 className="size-4" />
                  )}
                </Button>
              </Tooltip>
            )}
            <Tooltip content={t("ai.hidePanel")}>
              <Button
                size="icon"
                variant="ghost"
                className={PANEL_HEADER_ACTION_CLASS}
                aria-label={t("ai.hidePanel")}
                onClick={toggleAux}
              >
                <X className="size-4" />
              </Button>
            </Tooltip>
          </>
        }
      />

      {!configured ? (
        <EmptyState
          className="m-auto"
          icon={KeyRound}
          title={t("ai.setup.title")}
          description={t("ai.setup.description")}
          action={
            <Button size="sm" onClick={() => openSettings("ai")}>
              {t("ai.setup.action")}
            </Button>
          }
        />
      ) : view === "sessions" ? (
        <ChatList
          sessions={sessions}
          activeId={activeId}
          locale={locale}
          onOpen={(id) => void openChat(id)}
          onDelete={setDeleteTargetId}
        />
      ) : (
        <>
          <div
            ref={scrollRef}
            onScroll={onLogScroll}
            className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto"
          >
            <div
              ref={logContentRef}
              className="flex min-h-full min-w-0 max-w-full flex-col gap-[var(--content-gap)] px-3 py-4"
            >
              {sessionLoading ? (
                <div
                  className="my-auto text-center text-xs text-muted-foreground"
                  role="status"
                  aria-live="polite"
                >
                  {t("common.loading")}
                </div>
              ) : log.length === 0 ? (
                <div className="my-auto w-full max-w-md self-center py-8">
                  <div className="mb-2 flex items-center gap-1.5 px-1 text-muted-foreground">
                    <Sparkles className="size-3.5" strokeWidth={1.8} />
                    <h3 className="text-xs font-medium">
                      {t("ai.empty.title")}
                    </h3>
                  </div>
                  <div className="ui-divided-list">
                    {SUGGESTIONS.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        disabled={pending || !model || sessionLoading}
                        onClick={() => void sendPrompt(t(suggestion))}
                        className={cn(
                          "ui-list-row group flex w-full items-center text-left text-xs leading-normal text-foreground/75 transition-colors hover:bg-list-hover hover:text-foreground disabled:opacity-50",
                          INTERACTIVE_FOCUS_CLASS,
                        )}
                      >
                        <span className="min-w-0 flex-1">{t(suggestion)}</span>
                        <ArrowUp className="size-3.5 shrink-0 opacity-40 transition-opacity group-hover:opacity-80" />
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                log.map((item) => (
                  <LogEntry
                    key={item.id}
                    item={item}
                    onApprove={approve}
                    onDeny={deny}
                    onAnswer={answer}
                  />
                ))
              )}
              {showThinking && <ThinkingStatus />}
              {stepLimitReached && !pending && (
                <ContinueRun onContinue={continueRun} disabled={!model} />
              )}
            </div>
          </div>

          <div className="shrink-0 px-3 pb-3 pt-2">
            <div className="overflow-hidden rounded-lg border border-border-strong bg-surface-raised transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/35">
              {images.length > 0 && (
                <div className="px-2.5 pt-2.5">
                  <MessageImages
                    images={images}
                    onRemove={(id) =>
                      setImageDraft((current) => ({
                        ...current,
                        items: current.items.filter((image) => image.id !== id),
                      }))
                    }
                  />
                </div>
              )}
              <input
                ref={imageInputRef}
                type="file"
                accept={IMAGE_ACCEPT}
                multiple
                className="hidden"
                aria-label={t("ai.images.attach")}
                onChange={(event) => {
                  const files = Array.from(event.currentTarget.files ?? []);
                  event.currentTarget.value = "";
                  void addImages(files);
                }}
              />
              <Textarea
                ref={inputRef}
                rows={1}
                value={input}
                maxLength={MAX_AI_PROMPT_CHARS}
                disabled={sessionLoading}
                onChange={(e) => setInput(e.target.value)}
                onPaste={(event) => {
                  const files = Array.from(event.clipboardData.files);
                  if (files.length) {
                    if (!event.clipboardData.getData("text/plain"))
                      event.preventDefault();
                    void addImages(files);
                  }
                }}
                onCompositionStart={() => {
                  compositionActive.current = true;
                }}
                onCompositionEnd={() => {
                  compositionActive.current = false;
                }}
                onKeyDown={(e) => {
                  if (
                    shouldSubmitPrompt(e.nativeEvent, compositionActive.current)
                  ) {
                    e.preventDefault();
                    void submit();
                  }
                }}
                aria-label={t("ai.inputPlaceholder")}
                placeholder={t("ai.inputPlaceholder")}
                className="max-h-40 min-h-0 resize-none rounded-none border-0 bg-transparent px-3 pb-1.5 pt-2.5 focus-visible:ring-0"
              />
              <div className="flex min-w-0 items-center gap-1 px-1.5 pb-1.5 pt-1">
                <Tooltip
                  content={
                    preparingImages
                      ? t("ai.images.preparing")
                      : t("ai.images.hint")
                  }
                >
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-[var(--toolbar-control-size)] shrink-0"
                    aria-label={t("ai.images.attach")}
                    disabled={
                      preparingImages ||
                      sessionLoading ||
                      images.length >= MAX_MESSAGE_IMAGES
                    }
                    onClick={() => imageInputRef.current?.click()}
                  >
                    {preparingImages ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Plus className="size-4" />
                    )}
                  </Button>
                </Tooltip>
                {!activeId && targetOptions.length > 0 ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        className="h-[var(--toolbar-control-size)] w-auto min-w-0 max-w-56 shrink justify-start px-2 text-xs font-normal"
                        title={
                          executionTarget
                            ? `${executionTarget.label}${executionTarget.detail ? ` · ${executionTarget.detail}` : ""}`
                            : t("ai.executionTarget")
                        }
                        aria-label={t("ai.executionTarget")}
                      >
                        <TargetIcon className="size-3.5 text-muted-foreground" />
                        <span className="min-w-0 truncate">
                          {executionTarget?.label ?? t("ai.noExecutionTarget")}
                        </span>
                        <ChevronDown className="size-3.5 text-muted-foreground" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="start"
                      side="top"
                      className="max-h-96 w-72 overflow-y-auto"
                    >
                      <DropdownMenuRadioGroup
                        value={selectedTargetKey}
                        onValueChange={(value) => {
                          const option = targetOptions.find(
                            (item) => item.key === value,
                          );
                          if (!option) return;
                          const target = {
                            kind: option.kind,
                            id: option.id,
                            label: option.label,
                            detail: option.detail,
                          };
                          setDraftExecutionTarget(target);
                          if (option.kind === "terminal") {
                            focusPane(option.id);
                          }
                        }}
                      >
                        <ExecutionTargetMenuGroup
                          label={t("ai.targetGroup.hosts")}
                          options={hostTargetOptions}
                        />
                        <ExecutionTargetMenuGroup
                          label={t("ai.targetGroup.terminals")}
                          options={terminalTargetOptions}
                        />
                        <ExecutionTargetMenuGroup
                          label={t("ai.targetGroup.databases")}
                          options={databaseTargetOptions}
                        />
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : !activeId ? (
                  <Button
                    variant="ghost"
                    className="h-[var(--toolbar-control-size)] w-auto max-w-56 justify-start px-2 text-xs font-normal"
                    title={t("ai.executionTarget")}
                    aria-label={t("ai.executionTarget")}
                    disabled
                  >
                    <TargetIcon className="size-3.5 text-muted-foreground" />
                    <span className="truncate">
                      {t("ai.noExecutionTarget")}
                    </span>
                    <ChevronDown className="size-3.5 text-muted-foreground" />
                  </Button>
                ) : null}
                <ApprovalModeMenu
                  value={approvalMode}
                  onChange={changeApprovalMode}
                />
                <div className="ml-auto flex min-w-0 items-center justify-end gap-1">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        className="h-[var(--toolbar-control-size)] w-auto min-w-0 max-w-48 shrink justify-start px-2 text-xs font-normal"
                        title={model || t("ai.modelLabel")}
                        aria-label={t("ai.modelLabel")}
                        disabled={models.length === 0}
                      >
                        <span className="min-w-0 truncate">
                          {modelsLoading
                            ? t("ai.modelLoading")
                            : model || t("ai.modelEmpty")}
                        </span>
                        <ChevronDown className="size-3.5 text-muted-foreground" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      side="top"
                      className="max-w-64"
                    >
                      <DropdownMenuRadioGroup
                        value={model}
                        onValueChange={changeModel}
                      >
                        {models.map((item) => (
                          <DropdownMenuRadioItem key={item} value={item}>
                            <span className="truncate">{item}</span>
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {pending ? (
                    <Tooltip content={t("ai.stopHint")}>
                      <Button
                        size="icon"
                        variant="secondary"
                        className="size-[var(--toolbar-control-size)] shrink-0"
                        aria-label={t("ai.stop")}
                        onClick={() => activeId && stop(activeId)}
                      >
                        <Square className="size-3.5 fill-current" />
                      </Button>
                    </Tooltip>
                  ) : (
                    <Button
                      size="icon"
                      className="size-[var(--toolbar-control-size)] shrink-0"
                      aria-label={t("ai.send")}
                      disabled={
                        (!input.trim() && !images.length) ||
                        !model ||
                        sessionLoading ||
                        preparingImages
                      }
                      onClick={() => void submit()}
                    >
                      <ArrowUp className="size-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
      <ConfirmDialog
        state={
          deleteTargetId
            ? {
                title: t("ai.deleteChatTitle"),
                description: t("common.deleteConfirm", {
                  name:
                    sessions.find((session) => session.id === deleteTargetId)
                      ?.title || t("ai.untitledChat"),
                }),
                cancelLabel: t("common.cancel"),
                actions: [
                  {
                    label: t("ai.deleteChat"),
                    variant: "destructive",
                    loading: deletingSession,
                    onSelect: async () => {
                      setDeletingSession(true);
                      try {
                        await deleteSession(deleteTargetId);
                      } finally {
                        setDeletingSession(false);
                      }
                    },
                  },
                ],
              }
            : null
        }
        onClose={() => setDeleteTargetId(null)}
      />
    </aside>
  );
}

function ChatList({
  sessions,
  activeId,
  locale,
  onOpen,
  onDelete,
}: {
  sessions: AiSessionSummary[];
  activeId: string | null;
  locale: "en" | "zh-CN";
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useI18n();
  const today = new Date().toDateString();
  const timeFormatter = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  });

  if (sessions.length === 0) {
    return (
      <EmptyState
        fill
        icon={History}
        title={t("ai.noSessions")}
        className="m-auto"
      />
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <div className="ui-divided-list">
        {sessions.map((session) => {
          const active = session.id === activeId;
          const updatedAt = new Date(session.updatedAt);
          const updatedLabel = Number.isNaN(updatedAt.getTime())
            ? ""
            : (updatedAt.toDateString() === today
                ? timeFormatter
                : dateFormatter
              ).format(updatedAt);
          return (
            <div key={session.id} className="group flex items-center">
              <button
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => onOpen(session.id)}
                className={cn(
                  "ui-list-row flex min-w-0 flex-1 items-center gap-3 text-left transition-colors hover:bg-list-hover",
                  INTERACTIVE_FOCUS_CLASS,
                )}
              >
                <span className="min-w-0 flex-1 truncate text-sm">
                  {session.title || t("ai.untitledChat")}
                </span>
                {active && <Check className="size-3.5 shrink-0 text-link" />}
                <span className="shrink-0 text-2xs text-muted-foreground">
                  {updatedLabel}
                </span>
              </button>
              <Button
                size="icon"
                variant="ghost"
                className="mr-1 size-7 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                aria-label={t("ai.deleteChat")}
                onClick={() => onDelete(session.id)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ThinkingStatus() {
  const { t } = useI18n();

  return (
    <div
      className="text-xs text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      <span className="ai-thinking-label">{t("ai.thinking")}</span>
    </div>
  );
}

function ContinueRun({
  onContinue,
  disabled,
}: {
  onContinue: () => void;
  disabled: boolean;
}) {
  const { t } = useI18n();

  return (
    <div className="ui-muted-panel flex items-center justify-between gap-3 px-2.5 py-2">
      <span className="min-w-0 truncate text-xs text-muted-foreground">
        {t("ai.stepLimitReached")}
      </span>
      <Button
        size="sm"
        variant="secondary"
        className="h-[var(--toolbar-control-size)] shrink-0"
        disabled={disabled}
        onClick={onContinue}
      >
        {t("ai.continueRun")}
      </Button>
    </div>
  );
}

function LogEntry({
  item,
  onApprove,
  onDeny,
  onAnswer,
}: {
  item: AgentLogItem;
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
  onAnswer: (id: string, option: string) => void;
}) {
  if (item.kind === "tool") {
    if (
      item.name === "ask_user" &&
      askUserQuestion(item.args) &&
      askUserOptions(item.args).length >= 2
    ) {
      return <QuestionPrompt item={item} onAnswer={onAnswer} />;
    }
    return <ToolActivity item={item} onApprove={onApprove} onDeny={onDeny} />;
  }
  return (
    <Bubble
      role={item.kind}
      content={item.content}
      images={item.kind === "user" ? item.images : undefined}
    />
  );
}

function Bubble({
  role,
  content,
  images,
}: {
  role: "user" | "assistant";
  content: string;
  images?: AiImageAttachment[];
}) {
  if (role === "user") {
    return (
      <div className="ml-auto max-w-[88%] space-y-2 rounded-lg rounded-br-sm border border-border-subtle bg-muted px-3 py-2">
        {images?.length ? <MessageImages images={images} /> : null}
        {content && (
          <p className="select-text whitespace-pre-wrap break-words text-sm text-foreground/90">
            {content}
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="min-w-0 max-w-full select-text space-y-2 px-0.5">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={MARKDOWN_COMPONENTS}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function nodeText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  if ("value" in node && typeof node.value === "string") return node.value;
  if ("children" in node && Array.isArray(node.children)) {
    return node.children.map(nodeText).join("");
  }
  return "";
}

const MARKDOWN_COMPONENTS: Components = {
  p: ({ node: _node, ...props }) => (
    <p
      className="whitespace-pre-wrap break-words text-sm text-foreground/90"
      {...props}
    />
  ),
  a: ({ node: _node, href, ...props }) => (
    <a
      href={href}
      className="text-link underline underline-offset-2 hover:opacity-80"
      {...props}
      onClick={(e) => {
        e.preventDefault();
        const safeUrl = href ? safeExternalUrl(href) : null;
        if (safeUrl) void openUrl(safeUrl).catch(() => {});
      }}
    />
  ),
  img: ({ node: _node, alt }) => (
    <span className="text-sm text-muted-foreground">
      {alt ? `[Image: ${alt}]` : "[Image]"}
    </span>
  ),
  ul: ({ node: _node, ...props }) => (
    <ul
      className="list-disc space-y-1 pl-5 text-sm text-foreground/90"
      {...props}
    />
  ),
  ol: ({ node: _node, ...props }) => (
    <ol
      className="list-decimal space-y-1 pl-5 text-sm text-foreground/90"
      {...props}
    />
  ),
  li: ({ node: _node, ...props }) => (
    <li className="leading-relaxed" {...props} />
  ),
  h1: ({ node: _node, ...props }) => (
    <h1 className="mt-2 text-base font-semibold first:mt-0" {...props} />
  ),
  h2: ({ node: _node, ...props }) => (
    <h2 className="mt-2 text-[0.95rem] font-semibold first:mt-0" {...props} />
  ),
  h3: ({ node: _node, ...props }) => (
    <h3 className="mt-2 text-sm font-semibold first:mt-0" {...props} />
  ),
  h4: ({ node: _node, ...props }) => (
    <h4 className="mt-2 text-sm font-semibold first:mt-0" {...props} />
  ),
  h5: ({ node: _node, ...props }) => (
    <h5 className="mt-2 text-sm font-semibold first:mt-0" {...props} />
  ),
  h6: ({ node: _node, ...props }) => (
    <h6 className="mt-2 text-sm font-semibold first:mt-0" {...props} />
  ),
  blockquote: ({ node: _node, ...props }) => (
    <blockquote
      className="border-l-2 border-border pl-3 text-sm italic text-muted-foreground"
      {...props}
    />
  ),
  hr: ({ node: _node, ...props }) => (
    <hr className="my-2 border-border" {...props} />
  ),
  table: ({ node: _node, ...props }) => (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs" {...props} />
    </div>
  ),
  th: ({ node: _node, ...props }) => (
    <th
      className="border border-input px-2 py-1 text-left font-medium"
      {...props}
    />
  ),
  td: ({ node: _node, ...props }) => (
    <td className="border border-input px-2 py-1" {...props} />
  ),
  code: ({ node: _node, className: _className, ...props }) => (
    <code
      className="break-all rounded bg-muted px-1 py-0.5 font-mono text-[0.8em] text-foreground/90"
      {...props}
    />
  ),
  pre: ({ node }) => {
    const child = node?.children?.[0];
    const classes = child?.type === "element" ? child.properties.className : [];
    const language = Array.isArray(classes)
      ? String(
          classes.find((value) => String(value).startsWith("language-")) ?? "",
        ).replace(/^language-/, "")
      : "";
    return (
      <CodeBlock
        code={nodeText(child).replace(/\n$/, "")}
        language={language}
      />
    );
  },
};

function CodeBlock({ code, language }: { code: string; language: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useAiStore((state) =>
    state.activeId ? (state.runtime[state.activeId]?.pending ?? false) : false,
  );
  const [review, setReview] = useState<{
    id: string;
    name: string;
    code: string;
    session: NonNullable<ReturnType<typeof getSession>>;
    attempt: number;
  } | null>(null);
  const shell = [
    "sh",
    "bash",
    "zsh",
    "shell",
    "fish",
    "powershell",
    "pwsh",
  ].includes(language.toLowerCase());

  useEffect(
    () => () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    },
    [],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      toast.error(t("ai.error"), errorMessage(err));
    }
  };

  const run = () => {
    const state = useTabsStore.getState();
    const id = targetPaneId(state);
    const pane = findPane(state.tabs, id);
    const session = getSession(id);
    if (!pane || !session || pane.status !== "connected") {
      toast.error(t(pane ? "snippets.notConnected" : "snippets.noTerminal"));
      return;
    }
    const target = terminalTargetDisplay(state.tabs, pane.id);
    const name = target?.paneIndex
      ? `${target.title} · ${target.paneIndex}/${target.paneCount}`
      : pane.title;
    setReview({ id: pane.id, name, code, session, attempt: pane.attempt });
  };

  const executeReviewedCommand = () => {
    if (!review) return;
    const state = useTabsStore.getState();
    const pane = findPane(state.tabs, review.id);
    if (
      pane?.status !== "connected" ||
      pane.attempt !== review.attempt ||
      getSession(review.id) !== review.session
    ) {
      toast.error(t("snippets.notConnected"));
      return;
    }
    state.focusPane(review.id);
    if (useTabsStore.getState().sendToTerminal(review.code) === "sent") {
      toast.success(t("snippets.sent"));
    }
  };

  return (
    <div className="overflow-hidden rounded-lg border border-border-subtle bg-terminal-background">
      <div className="flex items-center justify-between border-b border-border px-2 py-1">
        <span className="text-2xs font-medium text-muted-foreground">
          {language || t("ai.codeLabel")}
        </span>
        <div className="flex gap-1">
          {shell && (
            <Tooltip content={t("ai.runCommand")}>
              <Button
                size="icon"
                variant="ghost"
                className="size-[var(--compact-control-size)]"
                aria-label={t("ai.runCommand")}
                disabled={pending}
                onClick={run}
              >
                <TerminalIcon className="size-3.5" />
              </Button>
            </Tooltip>
          )}
          <Tooltip content={copied ? t("common.copied") : t("common.copy")}>
            <Button
              size="icon"
              variant="ghost"
              className="size-[var(--compact-control-size)]"
              aria-label={copied ? t("common.copied") : t("common.copy")}
              onClick={copy}
            >
              {copied ? (
                <Check className="size-3.5 text-success" />
              ) : (
                <Copy className="size-3.5" />
              )}
            </Button>
          </Tooltip>
        </div>
      </div>
      <pre className="select-text overflow-x-auto p-2.5 font-mono text-xs leading-relaxed text-terminal-foreground">
        {code}
      </pre>
      <ConfirmDialog
        state={
          review
            ? {
                title: t("ai.confirmRun"),
                description: (
                  <>
                    <span className="block">
                      {t("ai.runCommandDescription", { name: review.name })}
                    </span>
                    <span className="mt-2 block max-h-64 select-text overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 font-mono text-xs">
                      {review.code}
                    </span>
                  </>
                ),
                cancelLabel: t("common.cancel"),
                actions: [
                  {
                    label: t("ai.runCommand"),
                    disabled: pending,
                    onSelect: executeReviewedCommand,
                  },
                ],
              }
            : null
        }
        onClose={() => setReview(null)}
      />
    </div>
  );
}

function MessageImages({
  images,
  onRemove,
}: {
  images: AiImageAttachment[];
  onRemove?: (id: string) => void;
}) {
  const { t } = useI18n();
  const [preview, setPreview] = useState<AiImageAttachment | null>(null);
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {images.map((image) => (
          <div key={image.id} className="relative">
            <button
              type="button"
              className={cn(
                "block overflow-hidden rounded-md border border-border-subtle",
                INTERACTIVE_FOCUS_CLASS,
              )}
              aria-label={t("ai.images.preview", { name: image.name })}
              onClick={() => setPreview(image)}
            >
              <img
                src={imageDataUrl(image)}
                alt={image.name}
                className="size-14 object-cover"
              />
            </button>
            {onRemove && (
              <Button
                type="button"
                size="icon"
                variant="secondary"
                className="absolute -right-1 -top-1 size-5 rounded-full"
                aria-label={t("ai.images.remove", { name: image.name })}
                onClick={() => onRemove(image.id)}
              >
                <X className="size-3" />
              </Button>
            )}
          </div>
        ))}
      </div>
      <Dialog
        open={!!preview}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{preview?.name || t("ai.images.attach")}</DialogTitle>
          </DialogHeader>
          {preview && (
            <img
              src={imageDataUrl(preview)}
              alt={preview.name}
              className="max-h-[70vh] w-full object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
