# Feature Requests

用户请求但当前系统尚未具备的能力。

---

## [FEAT-20261029-001] database_client

**Logged**: 2026-10-29T18:45:00+0800
**Priority**: high
**Status**: resolved
**Area**: frontend

### Requested Capability

在 Sageport 中加入数据库连接和查询能力，并放在“主机”菜单之后，形成“主机、数据库、凭据”的导航顺序。

### User Context

用户希望以 `t8y2/dbx` 为参考，在工作台内直接管理数据库，减少在 SSH 客户端和数据库 GUI 之间来回切换。

### Complexity Estimate

complex

### Suggested Implementation

支持 PostgreSQL、MySQL 和 SQLite；增加连接管理、连接测试、对象浏览、SQL 编辑与结果表格；连接信息保存在本地 SQLite，查询标签不写入工作区恢复状态。

### Metadata

- Frequency: first_time
- Related Features: hosts, credentials, terminal, sync

---

## [FEAT-20261030-001] ai_approval_modes

**Logged**: 2026-10-30T13:05:00+0800
**Priority**: high
**Status**: resolved
**Area**: frontend

### Requested Capability

参考 Codex 的批准模式，让 Sageport 助手支持无需逐次确认的自动执行模式。

### User Context

现有自动模式仍会对强制审批工具和受不可信内容影响的操作弹出确认，高频自动化任务因此被反复打断。

### Complexity Estimate

medium

### Suggested Implementation

使用“请求批准、智能审批、完全访问”三档权限；完全访问明确由用户选择并覆盖所有工具审批，同时保留模型主动提问。批准模式按聊天会话持久化，切换会话互不影响；旧 `ai.auto_approve` 配置继续兼容，全局 `ai.approval_mode` 作为新会话默认值。

### Metadata

- Frequency: recurring
- Related Features: assistant, permissions, settings, sync

---
