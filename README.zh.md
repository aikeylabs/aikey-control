# aikey-control

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

**AiKey Control** 个人版服务与 Web 用户界面的源代码——随 `local-install` 与团队试用包一同分发的 user-side 部分。

English: [README.md](README.md)

## 状态

🚧 **开发中**。本仓库包含 user 端服务模块与 Web 界面组件，后端服务在其他仓库维护。

## 范围

本仓库包含：

- **`service/pkg/`**——user 端服务对外的 Go 包（CLI 桥接、vault、intake、通用工具）
- **`service/appkit/user-local/`**——local-server 二进制的服务装配层
- **`web/src/`**——user 界面的 React / TypeScript SPA

本仓库**不**包含后端管理控制台、生产环境部署制品、团队试用打包工具。这些组件在独立的私有仓库中维护。

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
