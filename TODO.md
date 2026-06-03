# TODO — EchoMind

> 更新日期：2026-05-28（v0.3.5 之后，audit B2/B3/B4 + I1/I2/I3 已完成）
> 已完成的不在这。这是"还没做的"。
>
> ID 约定：`N` 用户新增需求，`D` 文档考古挖出来的（D1 = audit B1, D2-13 = §13 卡点清单, D14-20 = PLAN/MVP）。

---

## 🟥 P0 — 阻塞外发（公开 alpha 前必修）

| ID | 是什么 | 工作量 | 来源 |
|---|---|---|---|
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
| D12 | OpenClaw 官方文档阅读，记录 iLink 限流上限 | 0.5 天 | MVP 报告 |
| D13 | Closed Alpha 申请表（Tally / 飞书）+ 微信反馈群 | 半天 | MVP 报告 |
| D1b | **synthesize max_tokens 集成测试** — D1 第一轮覆盖了 4 文件 24 tests（embedding fallback 8 / N2 thoughts tree 8 / agent dedup 3 / bridge 401+refresh 5）；synthesize max_tokens 传递需要 LLM provider trait 抽象注入 mock，工程量大留作 follow-up | 0.5d | D1 spec 余项 |
| D21 | **release workflow GitHub 权限回归** — `tauri-action@v0` (SHA 84b9d35b...) 自 2026-06-01 起 create-release 报 `Resource not accessible by integration`；v0.3.6 (5/29) push trigger 还能成，v0.3.7 (6/1) push + dispatch 都挂在同一步。yaml + tauri-action SHA 都没变 → GitHub 那边动了东西。当前 workaround：每次 release 先 `gh release create v0.X.X --draft --notes "..."` 手动建 draft → 再 push tag / dispatch，tauri-action 找到现有 draft 就跳过 create。要查：repo Settings → Actions / Org-level fine-grained perms / 或 pin tauri-action 到具体 SHA 锁住行为 | 1h | 2026-06-01 ship 时遇到 |

## 🟩 P3 — 长期演进

| ID | 是什么 | 来源 |
|---|---|---|
| D14 | 「导出」更多 case 作为 Skills 实现（除 MD/DOCX/PDF 外，如 Roam EDN / Markdown 单文件 archive） | PLAN 阶段 5 |
| D15 | Obsidian 风格 **Plugin 系统** — 用户写 .js / .ts 扩展（M4，未开工） | PLAN 阶段 6 |
| D15b | **MCP client 子系统** — 让用户像 Claude Desktop 那样配 MCP servers（filesystem / GitHub / Notion 等任意工具）；agent 能调任意 MCP tool。短期 Tavily 走自写 Rust client（已 ship），MCP 作为高级用户扩展通道；长期把 EchoMind 也开成 MCP server（供 Claude Desktop / Cursor 读灵感库） | 2026-05-29 |
| D24 | **synthesize_chat_plan 模板全英文化** — D23 phase 4 只加了顶层 "respond in user's language" override，但 ~100 行的中文 section headings（一句话定位 / 核心假设与验证框架 / etc.）+ 6 维度框架描述 + 表格列名都还是中文。让 LLM 现场翻译能用但偶尔翻得不优雅；要完整英文模板就得照写一遍 EN 版本，按 locale 选 prompt。低优先级（bilingual override 在多数场景够用），等 EN 用户反馈 plan 质量再决定 | 0.5d | D23 phase 4 deferred |
| D25 | **Rust 端字符串 i18n**（tray menu / notification body / bridge command 错误 returns）— D23 phase 3 暂未推进；当前 src-tauri/src/lib.rs 的 tray "显示主窗口/速记浮窗/退出" + sync 通知 "从云端同步到 N 条新灵感" + bridge_cmds.rs 的 ~13 处 format!("...失败: {}", e) 都还是中文。EN UI 用户看到中文 tray 一致性差。方案：plumb locale 到 Rust shared state，或最简单的"全部改 EN"二选一。等 EN 用户报告再做 | 0.5d | D23 phase 3 deferred |
| D16 | **L3 Sync** — 多桌面 E2E 加密同步（产品三层架构里唯一未实现的） | MVP 报告 |
| D17 | 4 方对比测评草稿（vs Obsidian / Notion / Flomo / 语雀小记） | MVP 报告 |
| D18 | sqlite-vec 10K 规模 benchmark（验证 H4 性能假设） | MVP 报告 |
| D19 | LLM 计价模拟（200 条样本，验证 H3 单位经济） | MVP 报告 |
| D20 | VPS 14 天稳定性观察数据收集（H9） | MVP 报告 — in progress |

---

## 推荐执行序（杠杆 / 工作量比）

```
立即（< 半天）：
  D5 (e2e onboarding, 半天)
  D6 + D12 (各半天)

近期（1-3 天）：
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
