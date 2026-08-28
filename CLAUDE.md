# aikey-control（Server ControlPanel）

- 版型意识：Personal / Trial / Production / Cluster 每次改动分别考虑；共享能力放各 service 内部模块，不要放 trial-server 路由层 → [edition-awareness.md](../workflow/CI/IDE/claude/principles/edition-awareness.md)
- 慎重建表、慎重新建 API / 接口协议：至少列替代方案交用户拍板 → [careful-table-creation.md](../workflow/CI/IDE/claude/principles/careful-table-creation.md) / [careful-api-creation.md](../workflow/CI/IDE/claude/principles/careful-api-creation.md)
- 加 INSERT/SELECT 列或 DB 字段 struct，必须 baseline + migration + 真 schema 测试三处对齐 → [schema-code-coherence.md](../workflow/CI/IDE/claude/principles/schema-code-coherence.md)
- 服务端迁移在 `aikey-config-tool/pkg/dbmigrate/versions/`：双方言、幂等、版型隔离 → [migration-script-spec.md](../workflow/CI/IDE/claude/principles/migration-script-spec.md)
- 至少符合 CQRS（不要实时查询 events 表）；改动必须走活体事件验收，HTTP 200 不能当作入库证据 → [e2e-acceptance-live-events.md](../workflow/CI/IDE/claude/principles/e2e-acceptance-live-events.md)
