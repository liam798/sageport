import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as LocaleConfig from "@/i18n/config";

const { runAgentLoop, save, get, create, setApprovalMode } = vi.hoisted(() => ({
  runAgentLoop: vi.fn(),
  save: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  setApprovalMode: vi.fn(),
}));

vi.mock("./runner", () => ({ runAgentLoop }));
vi.mock("@/i18n/config", async (original) => ({
  ...(await original<typeof LocaleConfig>()),
  detectLocale: () => "en",
}));
vi.mock("@/lib/ipc", () => ({
  ipc: { ai: { session: { save, get, create, setApprovalMode } } },
}));

import { useAiStore } from "./store";
import type { AiImageAttachment } from "@/types/models";
import type { AiExecutionTarget } from "./execution-target";

const image: AiImageAttachment = {
  id: "image-1",
  name: "screen.png",
  mimeType: "image/png",
  data: "iVBORw0KGgo=",
  width: 1,
  height: 1,
};
const summary = {
  id: "chat",
  title: "Image chat",
  executionTarget: null,
  createdAt: "2026-09-08",
  updatedAt: "2026-09-08",
};

beforeEach(() => {
  vi.clearAllMocks();
  save.mockResolvedValue(summary);
  create.mockResolvedValue({
    ...summary,
    messages: [],
    approvalMode: "request",
  });
  setApprovalMode.mockResolvedValue(undefined);
  runAgentLoop.mockResolvedValue(undefined);
  useAiStore.setState({
    activeId: "chat",
    sessions: [summary],
    executionTargets: {},
    approvalModes: { chat: "request" },
    runtime: {
      chat: {
        history: [],
        log: [],
        pending: false,
        activity: null,
        requestId: null,
        stopRequested: false,
        stepLimitReached: false,
      },
    },
  });
});

describe("execution target lifecycle", () => {
  it("binds a target when creating a conversation", async () => {
    const database: AiExecutionTarget = {
      kind: "database",
      id: "db-1",
      label: "Orders",
    };
    create.mockResolvedValue({
      ...summary,
      id: "target-chat",
      messages: [],
      approvalMode: "assistant",
      executionTarget: database,
    });
    useAiStore.setState({ activeId: null, runtime: {} });

    const id = await useAiStore.getState().newSession("assistant", database);

    expect(create).toHaveBeenCalledWith("assistant", database);
    expect(useAiStore.getState().executionTargets[id]).toEqual(database);
  });

  it("restores the bound target when reopening a conversation", async () => {
    const database: AiExecutionTarget = {
      kind: "database",
      id: "db-1",
      label: "Orders",
    };
    useAiStore.setState({ runtime: {}, executionTargets: {} });
    get.mockResolvedValue({
      ...summary,
      approvalMode: "request",
      executionTarget: database,
      messages: [],
    });

    await useAiStore.getState().openSession("chat");

    expect(useAiStore.getState().executionTargets.chat).toEqual(database);
  });

  it("uses the bound target for later turns", async () => {
    const database: AiExecutionTarget = {
      kind: "database",
      id: "db-1",
      label: "Orders",
    };
    useAiStore.setState({ executionTargets: { chat: database } });

    await useAiStore
      .getState()
      .send("chat", "List tables", "model", ["list_database_schema"]);

    expect(runAgentLoop).toHaveBeenCalledWith(
      expect.anything(),
      "chat",
      "model",
      "request",
      ["list_database_schema"],
      undefined,
      database,
    );
  });
});

describe("approval mode lifecycle", () => {
  it("keeps approval modes isolated by conversation", async () => {
    await useAiStore.getState().setApprovalMode("chat", "full");
    await useAiStore.getState().setApprovalMode("other-chat", "assistant");

    expect(useAiStore.getState().approvalModes).toEqual({
      chat: "full",
      "other-chat": "assistant",
    });
    expect(setApprovalMode).toHaveBeenNthCalledWith(1, "chat", "full");
    expect(setApprovalMode).toHaveBeenNthCalledWith(
      2,
      "other-chat",
      "assistant",
    );
  });

  it("restores the persisted mode when reopening a conversation", async () => {
    useAiStore.setState({ runtime: {}, approvalModes: {} });
    get.mockResolvedValue({
      ...summary,
      approvalMode: "full",
      messages: [],
    });

    await useAiStore.getState().openSession("chat");

    expect(useAiStore.getState().approvalModes.chat).toBe("full");
  });
});

describe("image conversation lifecycle", () => {
  it("sends and persists an image-only user turn", async () => {
    await useAiStore
      .getState()
      .send("chat", "", "vision-model", [], null, [image]);
    expect(runAgentLoop).toHaveBeenCalledTimes(1);
    expect(useAiStore.getState().runtime.chat.history[0]).toMatchObject({
      role: "user",
      content: "",
      images: [image],
    });
    expect(save.mock.calls[0][1][0].images).toEqual([image]);
    expect(useAiStore.getState().runtime.chat.log[0]).toMatchObject({
      kind: "user",
      images: [image],
    });
  });

  it("restores image attachments when reopening a saved conversation", async () => {
    useAiStore.setState({ runtime: {} });
    get.mockResolvedValue({
      ...summary,
      approvalMode: "request",
      messages: [{ role: "user", images: [image] }],
    });
    await useAiStore.getState().openSession("chat");
    expect(useAiStore.getState().runtime.chat.log[0]).toMatchObject({
      kind: "user",
      images: [image],
    });
  });
});
