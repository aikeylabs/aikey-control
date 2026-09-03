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
- **`web/src/`**——user 界面的 React / TypeScript SPA（见[主题](#主题浅色--深色)）

本仓库**不**包含后端管理控制台、生产环境部署制品、团队试用打包工具。这些组件在独立的私有仓库中维护。

## 二进制分发

终端用户通过以下方式安装：

```
curl -fsSL https://raw.githubusercontent.com/aikeylabs/launch/main/install.sh | bash
```

官方 `local-install` 二进制由本仓库源码 + 私有打包工具构建，并附带 cosign + 平台签名以及 SBOM。


## 主题（浅色 + 深色）

控制台提供两套配色。深色 "Industrial Vault" 主题是默认且**未改动**，浅色主题是在其之上增量添加的。

`index.html` 里一段阻塞脚本在首帧前把 `data-theme` 写到 `<html>`。未存显式选择时跟随系统并持续实时跟随；
用户从顶栏切换。

**深色是「无属性」状态。** 深色配色在裸 `:root` 上，浅色是 `[data-theme='light']`，没有任何代码写
`data-theme="dark"`。这是安全属性：任何跑不到 boot 脚本的路径（缓存旧包、JS 落地前那一帧、截图 harness）
都落回 `:root`，渲染出的就是原来的控制台。

**几何与字体不是主题作用域。** `--radius-*`、`--font-*` 和密度是共享的同一份值，因此浅色继承深色的
2/4/6px 圆角和等宽 chrome。往浅色块里加圆角或字体覆盖会同时改到深色。

**浅色强调色分两档**：`--primary`（`#e8502a`，画布上 3.14:1）用于填充与图标，`--primary-text`
（`#b23a17`，5.02:1）用于强调文字。深色的 `#facc15` 在白底上只有 1.53:1，无法复用。

**页面代码禁止硬编码中性色。** `src/shared/utils/no-raw-neutral.test.ts` 强制为 0。裸中性色无法跟随主题，
最糟的那类是**直接消失**而非颜色不对 —— `rgba(255,255,255,.02)` 在白卡片上完全不可见。请改用令牌：

| 不要写 | 改用 |
|--------|------|
| `#18181b` / `#1f1f23` / `#27272a` | `var(--background)` / `var(--surface-sunken)` / `var(--card)` |
| `#3f3f46` | `var(--border)`（描边）/ `var(--surface-inset)`（填充） |
| `#a1a1aa` / `#71717a` | `var(--muted-foreground)` / `var(--faint-foreground)` |
| `rgba(255,255,255,α)` / `rgba(0,0,0,α)` | `rgba(var(--lift-rgb), α)` / `rgba(var(--sink-rgb), α)` |
| 模态遮罩或投影 | `rgba(var(--scrim-rgb), α)` |
| 吸顶导航背景 / 下沉井 | `var(--backdrop-chrome)` / `var(--well-recessed)` |

`src/index.css` 是完整令牌表，且与团队控制台的副本逐字节一致。

## 构建（开发）

本仓库是更大代码库的切片，当前 snapshot 不一定独立可构建——Phase 1 拆分是代码可见性里程碑，不是 self-contained 构建。Phase 2 将引入独立的 `go.mod` 和 CI，确保对本仓库单独执行 `go build ./...` 能通过。

## 贡献

欢迎外部贡献者在公开表面（pkg/* / user-side API handler / `pages/user/` 下的 Web 页面）参与。非琐碎改动请先开 issue 讨论。

## 安全

请将漏洞私下报告至 security@aikey.dev（不要公开开 issue）。

## 许可证

[Apache License 2.0](LICENSE) © AiKey Labs
