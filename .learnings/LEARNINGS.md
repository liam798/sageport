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
