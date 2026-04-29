# aikey-control

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

**AiKey Control** 个人版服务与 Web 用户界面的源代码——随 `local-install` 与团队试用包一同分发的 user-side 部分。

English: [README.md](README.md)

## 状态

🚧 **开发中**。本仓库于 2026-04-29 从更大的单一仓库中拆分而来，是公开/私有拆分工作的一部分。拆分前的完整开发历史保留在私有 master 仓库 `AiKeyLabs/aikey-control-master`（仅维护者可访问）。

## 范围

本仓库包含：

- **`service/pkg/`**——user / master 双侧共用的 Go 包（identity / snapshot / managedkey / 通用工具）
- **`service/internal/referral/`**——推荐追踪
- **`service/internal/api/user/`**——user 端 API handler（密钥分发、vault、导入等）
- **`service/appkit/{core,user}/`**——user-only 模式的服务装配层
- **`web/src/{app,layouts,features,pages/user,shared}/`**——user 界面的 React / TypeScript SPA

本仓库**不**包含：

- master / 管理控制台 UI（`pages/master/`、`shared/api/master/`）
- master 服务模块（组织管理、provider credential 管理）
- 生产环境部署制品（Docker compose、控制面 service 二进制）
- trial-server 装配层（团队试用版的合并打包）

这些组件保留在私有仓库（`aikey-control-master`、`aikey-trial-server`）。

## 二进制分发

终端用户通过以下方式安装：

```
curl -fsSL https://raw.githubusercontent.com/aikeylabs/launch/main/install.sh | bash
```

官方 `local-install` 二进制由本仓库源码 + 私有打包工具构建，并附带 cosign + 平台签名以及 SBOM。

## 构建（开发）

本仓库是更大代码库的切片，当前 snapshot 不一定独立可构建——Phase 1 拆分是代码可见性里程碑，不是 self-contained 构建。Phase 2 将引入独立的 `go.mod` 和 CI，确保对本仓库单独执行 `go build ./...` 能通过。

## 贡献

欢迎外部贡献者在公开表面（pkg/* / user-side API handler / `pages/user/` 下的 Web 页面）参与。非琐碎改动请先开 issue 讨论。

## 安全

请将漏洞私下报告至 security@aikey.dev（不要公开开 issue）。

## 许可证

[Apache License 2.0](LICENSE) © AiKey Labs
