# TODO — EchoMind

> 更新日期：2026-05-28（v0.3.5 之后，audit B2/B3/B4 + I1/I2/I3 已完成）
> 已完成的不在这。这是"还没做的"。
>
> ID 约定：`N` 用户新增需求，`D` 文档考古挖出来的（D1 = audit B1, D2-13 = §13 卡点清单, D14-20 = PLAN/MVP）。

---

## 🟥 P0 — 阻塞外发（公开 alpha 前必修）

| ID | 是什么 | 工作量 | 来源 |
|---|---|---|---|
| D1 | **自动化测试覆盖** — 至少 4-6 个集成测试（bridge sync 401 退避 / embedding fallback 8 组合 / synthesize max_tokens 传递 / agent tool dedup），CI 加 `cargo test --workspace` | 1 天 | audit B1 |
| D2 | **Mac 代码签名** — Apple Developer ID 注册 + signing pipeline 接入 desktop-release.yml | \$99 + 半天 | §13 P1 #5 |
| D3 | **Windows 签名兜底文档** — SmartScreen 提示用户右键打开（短期，长期上 EV 证书） | 1 小时 | §13 P1 #5 |

## 🟧 P1 — 体验阻碍（外发前必做）

| ID | 是什么 | 工作量 | 来源 |
|---|---|---|---|
| D4 | **Phase 4 三项**：(a) `/bridge/chat` 速率限制 / (b) bridge 客户端断线重连指数退避 / (c) Budget 超限 Tauri 事件通知 | 1-2 周 | §13 P1 #10 |
| D5 | **自己 e2e 走一遍完整 onboarding + 微信桥扫码** — 找出 dead loop / 状态机死锁 | 半天 | §13 P1 #8 |
| D6 | LLM Key 注册引导文档（一键链接 + DeepSeek 充值教程） | 半天 | §13 P1 #6 |
| D7 | fastembed 400MB+ 首次下载文档（hf-mirror 镜像提示 + 长期分发本地缓存） | 半天 + 长期 | §13 P2 #14 |

## 🟨 P2 — 公开发布前

| ID | 是什么 | 工作量 | 来源 |
|---|---|---|---|
| **N2** | **同主题追加（thread / follow-up）** — phase 1（schema + cascade）✅ d2ac703；phase 2（folder-fold UI + AI 看完整 thread）✅ 1bf4137；**剩 phase 3-5**：微信 router 识别"补充：/追加：" + bridge sync 带 parent_id + 集成测试 | ≈ 3 天 | user 2026-05-28 |
| D8 | 用户协议 / 隐私政策（"知情同意"叙事必备） | 1-2 周含外部 | §13 P2 #11 |
| D9 | Landing Page — Vercel 部署 1 页（公开发布入口） | 2-3 天 | §13 P2 #12 |
| D10 | 支付通道 — Stripe 国际 + 国内 Pingxx / 易支付 | 1 周 | §13 P2 #13 |
| D11 | DB 迁移日志静默化（`ALTER TABLE` 满屏不专业） | 1 小时 | §13 P2 #15 |
| D12 | OpenClaw 官方文档阅读，记录 iLink 限流上限 | 0.5 天 | MVP 报告 |
| D13 | Closed Alpha 申请表（Tally / 飞书）+ 微信反馈群 | 半天 | MVP 报告 |

## 🟩 P3 — 长期演进

| ID | 是什么 | 来源 |
|---|---|---|
| D14 | 「导出」更多 case 作为 Skills 实现（除 MD/DOCX/PDF 外，如 Roam EDN / Markdown 单文件 archive） | PLAN 阶段 5 |
| D15 | Obsidian 风格 **Plugin 系统** — 用户写 .js / .ts 扩展（M4，未开工） | PLAN 阶段 6 |
| D15b | **MCP client 子系统** — 让用户像 Claude Desktop 那样配 MCP servers（filesystem / GitHub / Notion 等任意工具）；agent 能调任意 MCP tool。短期 Tavily 走自写 Rust client（已 ship），MCP 作为高级用户扩展通道；长期把 EchoMind 也开成 MCP server（供 Claude Desktop / Cursor 读灵感库） | 2026-05-29 |
| D16 | **L3 Sync** — 多桌面 E2E 加密同步（产品三层架构里唯一未实现的） | MVP 报告 |
| D17 | 4 方对比测评草稿（vs Obsidian / Notion / Flomo / 语雀小记） | MVP 报告 |
| D18 | sqlite-vec 10K 规模 benchmark（验证 H4 性能假设） | MVP 报告 |
| D19 | LLM 计价模拟（200 条样本，验证 H3 单位经济） | MVP 报告 |
| D20 | VPS 14 天稳定性观察数据收集（H9） | MVP 报告 — in progress |

---

## 推荐执行序（杠杆 / 工作量比）

```
立即（< 半天）：
  D11 (DB 日志静默, 1h)
  D5 (e2e onboarding, 半天)
  D6 + D12 (各半天)

近期（1-3 天）：
  D1 (测试覆盖, 1 天)
  D3 (Win 签名兜底文档, 1h)
  N2 phase 3-5 (微信 router + bridge sync + 测试，≈ 3 天)
  D9 (Landing Page, 2-3 天)

中期（1-2 周）：
  D4 (Phase 4 三项)
  D8 (用户协议 / 隐私政策)
  D10 (支付通道)

长期（按需）：
  D2 (Mac 签名，$99 投入)
  D7 (fastembed 镜像方案)
  D13 (Alpha 申请表)
  D14-D20 (按 v0.4 / v0.5 节奏排)
```

---

## 维护约定

- 完成一项 → 删除整行（不是打 ✅，避免文件膨胀）
- 新增 → 加在对应 P 段表格末尾，ID 续号
- 已 ship 的版本号附在描述末（如 "✅ v0.3.7" 仅在临时 wip 时短期保留）
- 严重程度变化 → 整行移到对应段
- 这个文件**不进 docs/architecture-hybrid-cloud.md** 决策日志——日志记"做了什么 + 为什么"，TODO 是 forward-looking
