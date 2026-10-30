# Learnings

纠错、经验和知识缺口。

---

## [LRN-20261029-001] config

**Logged**: 2026-10-29T17:41:13+0800
**Priority**: high
**Status**: resolved
**Area**: config

### Summary

macOS 应用默认安装目录应使用系统 `/Applications`，而不是用户目录下的 `~/Applications`。

### Details

最初将构建脚本默认安装目录设为 `~/Applications`。用户明确要求安装到系统默认的 `/Applications`，并保留通过环境变量覆盖安装目录的能力。

### Suggested Action

安装类脚本默认遵循系统标准目录；如果存在用户级备选路径，通过显式环境变量提供，并在文档中说明。

### Metadata

- Source: user_feedback
- Related Files: scripts/build-install-macos.sh, README.md, README.zh-CN.md
- Tags: macos, applications, build, installation

---

## [LRN-20261030-001] layout

**Logged**: 2026-10-30T11:44:00+0800
**Priority**: medium
**Status**: resolved
**Area**: frontend

### Summary

放大 AI 助手时应保留当前左侧栏状态，而不是强制收起左侧栏。

### Details

用户明确要求最大化面板尊重主侧边栏：左侧栏展开时，助手填充左侧栏右侧的剩余工作区；只有左侧栏本身收起时，助手才占满整个工作区。聊天标题已有的返回按钮也足以进入历史列表，因此聊天页不再重复显示历史图标。

### Suggested Action

面板最大化只改变目标面板与主工作区之间的占用关系，不隐式修改其他独立侧栏的可见状态。

### Metadata

- Source: user_feedback
- Related Files: src/workbench/Workbench.tsx, src/workbench/layout.ts, src/features/ai/AssistantPanel.tsx
- Tags: workspace, ai-panel, sidebar, maximize

---

## [LRN-20261030-002] layout

**Logged**: 2026-10-30T12:00:42+0800
**Priority**: medium
**Status**: resolved
**Area**: frontend

### Summary

工具栏中的选择器应随当前选项文字自适应宽度，不应使用固定百分比容器撑满可用空间。

### Details

Compose 底部的终端与模型选择器最初使用百分比宽度和占满父容器的原生 Select，短文本也会留下大块空白。改为基于实际内容的菜单触发器后，选择器会随文字收紧，长文本在达到上限后截断，下拉箭头保持可见。

### Suggested Action

紧凑工具栏选择器默认采用内容宽度，仅设置合理的最大宽度和最小收缩能力；避免给触发器外层使用 `w-full` 或无关的固定比例。

### Metadata

- Source: user_feedback
- Related Files: src/features/ai/AssistantPanel.tsx
- Tags: ai-compose, selector, intrinsic-width, toolbar

---

## [LRN-20261030-003] ai-context

**Logged**: 2026-10-30T12:15:00+0800
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary

AI 的执行目标应是用户可选择的资源抽象，而不是只绑定当前已打开的终端。

### Details

执行目标现在统一包含已保存主机、已打开终端和已保存数据库。主机和数据库无需先打开即可选择；主机目标会在首次终端工具调用前创建或复用会话，并等待连接稳定后再执行。

### Suggested Action

新增 AI 操作入口时，优先建模用户资源及其解析方式，避免把界面入口限制为当前打开的标签页。

### Metadata

- Source: user_feedback
- Related Files: src/features/ai/execution-target.ts, src/features/ai/AssistantPanel.tsx, src/features/ai/runner.ts
- Tags: ai, execution-target, host, terminal, database

---

## [LRN-20261030-004] ai-context

**Logged**: 2026-10-30T12:32:00+0800
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary

AI 执行目标必须按聊天会话保存，并且目标的上下文声明与实际暴露的工具保持一致。

### Details

执行目标不能再根据当前工作台标签动态推导，否则切换标签会改变整个聊天的目标。数据库目标现在只向模型暴露数据库工具，并明确要求使用 schema 和 query 工具，不得绕到主机、凭据、端口或文件系统探测。

### Suggested Action

为 AI 增加资源目标时，同时定义目标的持久范围、可用工具集合和禁止的回退路径，避免模型在缺少目标工具时自行选择其他资源。

### Metadata

- Source: user_feedback
- Related Files: src/features/ai/AssistantPanel.tsx, src/features/ai/store.ts, src/features/ai/runner.ts, src/features/ai/tools/registry.ts
- Tags: ai, execution-target, tool-scope, database

---

## [LRN-20261030-005] ai-compose

**Logged**: 2026-10-30T14:52:00+0800
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary

批准模式属于输入区的会话操作，执行目标属于创建会话时一次性绑定的上下文。

### Details

批准模式入口应放在 Compose 工具行，与执行目标和模型并列，不应占用会话标题栏。执行目标只允许在创建会话前选择；创建后将会话标题处展示目标标签，并由数据库持久化绑定，后续切换标签、恢复会话或继续对话都不得更改目标。

### Suggested Action

区分“可随会话调整的策略”和“定义会话上下文的不可变属性”：前者保留输入区控制，后者在会话创建时原子写入并在标题处只读展示。

### Metadata

- Source: user_feedback
- Related Files: src/features/ai/AssistantPanel.tsx, src/features/ai/store.ts, src-tauri/src/commands/ai.rs, src-tauri/src/repository/ai_session_repo.rs
- Tags: ai, approval-mode, execution-target, session-context

---
