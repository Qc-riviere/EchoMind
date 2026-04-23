# EchoMind 混合架构方案：本地主库 + 云端微信桥

## 1. 架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                       用户设备（本地）                            │
│                                                                  │
│  ┌────────────┐   ┌────────────┐   ┌──────────────────────┐    │
│  │  React UI  │──▶│ Rust Core  │──▶│ SQLite + 向量库      │    │
│  │ (想法/对话) │   │(agent/llm) │   │ （所有数据留本地）    │    │
│  └────────────┘   └─────┬──────┘   └──────────────────────┘    │
│                          │                                      │
│                          │ WSS 持久连接（JWT 鉴权 + AES 加密）  │
│                          │                                      │
└──────────────────────────┼──────────────────────────────────────┘
                           │
              ── 公网（TLS 1.3） ──
                           │
┌──────────────────────────┼──────────────────────────────────────┐
│                    云端 VPS（轻量）                               │
│                          ▼                                      │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │       WX Bridge Daemon (Node.js，现有代码搬上云)          │   │
│  │                                                           │   │
│  │  ┌──────────────┐   ┌──────────────────────────────────┐ │   │
│  │  │ iLink 长轮询 │──▶│ 消息路由（与本地版同逻辑）       │ │   │
│  │  │ getupdates   │   │ capture / list / search / chat   │ │   │
│  │  └──────────────┘   └────┬─────────────────────────────┘ │   │
│  │                          ▼                                │   │
│  │  ┌──────────────────────────────────────────────────────┐│   │
│  │  │  VPS 端 echomind-server（轻量）                       ││   │
│  │  │  ┌──────────────┐   ┌──────────────────────────────┐││   │
│  │  │  │ 上云子集     │   │ 向量索引（同子集）            │││   │
│  │  │  │ SQLite       │   │ 用于手机 /search             │││   │
│  │  │  │ 用户选范围   │   │                              │││   │
│  │  │  └──────┬───────┘   └──────────────────────────────┘││   │
│  │  └─────────┼─────────────────────────────────────────────┘│   │
│  │            │ 差量同步（本地 → VPS，单向）                 │   │
│  │            │ WSS 推送新消息到本地（双向）                 │   │
│  └────────────┼─────────────────────────────────────────────┘   │
│               ▲                                                  │
│               │ iLink bot_token（HTTPS）                         │
└───────────────┼──────────────────────────────────────────────────┘
                │
                ▼
       ┌────────────────┐
       │ 微信 iLink 服务 │
       └────────┬───────┘
                │
                ▼
         手机微信（你用 bot 录/查想法）
```

## 2. 核心设计原则（按 Obsidian Sync 模式修正）

| 原则 | 说明 |
|------|------|
| **明确隐私代价** | WX Bridge 是付费可选项，开启即代表用户知情同意：经手机 WX 访问的想法会过腾讯 iLink + VPS。未经 WX 访问的想法仍 100% 本地 |
| **用户控制上云子集** | 只有用户明确勾选范围（时间窗 / 特定标签 / 标星）的想法才同步到 VPS，其余绝不出本地 |
| **本地是唯一真源** | VPS 上的子集只是"投影"，可随时清空/重建；本地关机不影响手机 bot 使用（VPS 有自足的子集 + 向量索引） |
| **云端无 AI 托管** | VPS 不保管 LLM key；/chat 对话若需要 AI，走 VPS 上的用户自备 key（同本地配置） |

## 3. 数据流

Bot 是单人工具，场景是**你用手机 WX 远程操作自己的第二大脑**，不涉及朋友对话。

### 3.1 手机发文字（录入想法）

```
手机 WX 输入 ──▶ iLink ──▶ VPS daemon
                              │
                              ├─ 写入 VPS 子集 SQLite
                              ├─ 生成向量 / embed
                              └─ 差量推送到本地（本地在线时）
                                  或加入 pending 队列（本地离线时）
                                  → 本地上线后合并进主库
```

### 3.2 手机发 `/list`、`/search`、`/view`、`/chat`

```
手机 WX 输入命令 ──▶ iLink ──▶ VPS daemon
                                 │
                                 ▼
                   VPS 子集 SQLite + 向量索引（自足）
                                 │
                                 ▼
                            返回结果 ──▶ iLink ──▶ 手机 WX

本地 app 离线也不影响查询，因为 VPS 有用户选定范围的副本。
```

### 3.3 桌面 app 录入 → 同步到 VPS（单向差量）

```
桌面 Tauri App 录入想法
    │
    ├─ 写入本地 SQLite（完整主库）
    │
    └─ 命中"上云子集规则" → WSS 推送到 VPS → 写入 VPS 子集

未命中规则的想法永不上云。
```

## 4. 隐私边界（Obsidian Sync 风格：明确代价）

开启 WX Bridge 前用户看到的知情同意提示：

> ⚠️ 开启 WX Bridge = 接受以下数据流经第三方：
> - 你的上云子集（由你选择）经过 **腾讯 iLink** 服务器和你的 **VPS**
> - 未加入上云子集的想法**绝不出本地**
> - VPS 可由你随时清空或迁移；停止订阅即自动销毁
> - LLM API key 仍在本地，VPS 仅在你明确授权 /chat 时代调

```
╔════════════════════════════╦════════════════════════════════════╗
║  经 WX Bridge 时云端可见    ║  任何时候只在本地                  ║
╠════════════════════════════╬════════════════════════════════════╣
║ 上云子集内的想法内容        ║ 未加入子集的所有想法               ║
║ /search 查询关键词          ║ 完整向量索引                       ║
║ /chat 对话上下文            ║ 桌面端对话历史                     ║
║ bot 发给你的回复            ║ LLM API Key（默认）               ║
║ 向量检索结果（子集内）      ║ 用户偏好设置                       ║
║ 设备在线状态                ║                                    ║
╚════════════════════════════╩════════════════════════════════════╝
```

## 5. 组件详细设计

### 5.1 云端 WX Bridge Daemon

```
协议：微信官方 iLink Bot API（ilinkai.weixin.qq.com）
技术栈：Node.js daemon + 轻量版 echomind-server（Rust，已有）
部署：Docker / systemd 皆可（不再是无状态，因为持有子集数据）
成本：~¥15-20/月（最小规格 + 小量存储）

职责：
├── iLink daemon：长轮询 + 发送（复用 echomind-wechat/）
├── echomind-server（轻量版）：
│   ├── 持有"上云子集" SQLite + 向量索引
│   ├── 响应 /list /search /view /chat /capture 命令
│   └── 对接用户自备 LLM key 做 /chat（用户订阅时配置）
├── WSS 服务端：双向同步新消息 / 新想法 ↔ 本地 app
└── 设备配对鉴权（JWT 签发 + 验证）

关键点：
- bot_token + VPS 子集数据 = 付费订阅状态
- 停止订阅 → VPS 销毁数据 + 自动登出 bot
- 用户可在本地设置里"清空云端子集"作为隐私保护
```

### 5.2 本地 WSS 客户端（Tauri 侧）

```
技术栈：tokio-tungstenite（Rust）
位置：echomind-core 新模块

职责：
├── 自动重连（指数退避）
├── 心跳保活（30s ping/pong）
├── 消息加解密（AES-256-GCM）
├── 离线消息重放处理
└── 连接状态上报到 UI
```

### 5.3 消息缓存（简化，不必 Redis）

```
因为 iLink 长轮询自带 get_updates_buf 游标，VPS 重启/掉线后
重新拉取不丢消息。只需要一个极简的本地文件缓存：

├── /var/lib/echomind-bridge/state.json
│     └── { bot_token, baseurl, last_update_buf, offline_reply_config }
└── /var/lib/echomind-bridge/pending.jsonl
      └── 本地 app 离线时累积的消息（append-only，上线后批量投递 + 清空）

可选升级：单设备量大时换 SQLite；还不够再上 Redis。
MVP 阶段不引入 Redis。
```

### 5.4 设备配对流程

```
首次连接：
1. 本地 app 扫码登录 iLink，拿到 bot_token
2. 本地 app 生成 device_id + sync_key（对称密钥，用于差量同步加密）
3. 用户确认"上云子集规则"（见 §5.5）
4. 用户点击"部署到云端"，本地推送到 VPS：
   { bot_token, baseurl, device_id, sync_key, subset_rules,
     llm_config?（可选，用于 /chat）}
5. VPS 签发 JWT（绑定 device_id + bot_token），返回给本地
6. 本地存储 JWT，后续 WSS 连接自动认证
7. 本地按 subset_rules 做初次全量上传（子集范围内想法 + 向量）

无需账号系统。bot_token 可随时重推（覆盖即迁移）。
取消订阅 → 本地调用 /bridge/terminate → VPS 销毁所有数据。
```

### 5.5 "上云子集"规则（用户自选）

用户在桌面 app 的 Bridge 设置页面配置哪些想法上云。规则组合生效（任一命中即上云）：

```
┌─ 时间窗 ─────────────────────────────────
│ ☐ 最近 7 天
│ ☐ 最近 30 天        ← 推荐起步
│ ☐ 最近 90 天
│ ☐ 全量（= 实际做了 L3 Sync，明确警告）
├─ 标签过滤 ──────────────────────────────
│ ☐ 仅标星想法
│ ☐ 包含任一标签：[多选框]
│ ☐ 排除任一标签：[多选框]   （敏感想法打标排除）
├─ 来源过滤 ──────────────────────────────
│ ☐ 仅桌面录入的上云
│ ☐ 仅 bot 录入的上云（= 反正已经过 iLink 了）
└──────────────────────────────────────────

估算：勾选"最近 30 天 + 排除 #私密"，典型用户 ~5 MB 数据量
```

**同步行为：**

| 触发 | 行为 |
|---|---|
| 本地新增想法命中规则 | 立即差量推送到 VPS |
| 本地修改已上云想法 | 推送 diff 到 VPS |
| 本地删除已上云想法 | VPS 同步删除 |
| 想法老化出时间窗 | VPS 自动清理（定时任务） |
| 用户手动"清空云端子集" | 本地发命令，VPS 立即销毁子集，bot 仍可用（新录入重新积累） |

**关键约束：**
- 同步**单向**：本地 → VPS（bot 新录入的消息走另一条路：VPS → 本地主库归并）
- 向量索引在 VPS 侧基于子集重新构建，不从本地推送（避免敏感向量泄露）
- `sync_key` 用于推送加密；VPS 解密后落盘（因为要响应搜索）——**这是明确的隐私代价**

## 6. iLink 协议注意事项（替代原"风控"章节）

iLink 是官方 bot 协议，无封号风控问题，但有以下约束：

| 项 | 说明 |
|---|---|
| Session 过期 | `getupdates` 返回 `ret=-14` 表示 token 失效，需扫码重新登录 |
| 长轮询超时 | 35s 无消息即返回，daemon 需立即发起下一轮 |
| 消息去重 | iLink 可能重发，需用 `message_id` 本地去重（现有代码已做，`MAX_DEDUP_IDS=1000`） |
| 游标丢失 | 不传 `get_updates_buf` 会拿到最近一批历史消息（幂等安全，但有重复风险） |
| Bot 账号性质 | Bot 是独立账号，朋友加 bot 而非加主号，主号完全不介入 |

## 7. 实现阶段

### Phase 1：VPS 服务端 ✅

- [x] `echomind-bridge-server`（axum 0.8 + rusqlite bundled）
- [x] HTTP 接口：`POST /bridge/config`、`/bridge/thoughts/upsert`、`/bridge/thoughts/delete`、`/bridge/terminate`
- [x] JWT 鉴权中间件（`auth.rs`）
- [x] AES-256-GCM 加密存储 bot_token / llm_config（`crypto.rs`）
- [x] 每设备 SQLite + sqlite-vec 向量索引（`db.rs`）
- [x] 配对码系统（8 字符、TTL、一次性）（`pairing.rs`）
- [x] 管理接口（`/admin/pair-codes`、`/admin/devices`、`/admin/audit`）

### Phase 2：本地对接 ✅

- [x] Rust Bridge 客户端（`echomind-core/src/bridge/client.rs`）
- [x] Cloud Bridge 页面：配对 + 子集规则 + 知情同意提示
- [x] 子集规则引擎（`bridge/rules.rs`）：时间窗 / 包含标签 / 排除标签 / 排除归档
- [x] 生命周期钩子：create / update / enrich / embed / archive / delete 自动触发推送/删除
- [x] 初始全量同步命令（`cloud_bridge_initial_sync`）
- [x] 思想读取接口：`GET /bridge/thoughts`、`POST /bridge/thoughts/search`

### Phase 3：/chat LLM 转发 ✅

- [x] 本地可选推送 LLM 配置到 VPS（`cloud_bridge_push_llm_config`，默认不推）
- [x] VPS 执行 `/chat` 时调用存储的 LLM（OpenAI / Claude / Gemini 三家）
- [x] 预算硬上限（`budget_cents`）+ 超额原子停用（`add_usage`）
- [x] UI：Cloud Bridge 页面 LLM 远程执行卡片（知情同意 + 预算输入 + 状态面板）
- [x] echomind-wechat bridge 独立模式：env 变量激活，`/list`、`/search`、`/view`、`/chat`、`/status` 全支持

### Phase 4：部署与稳定性（进行中）

- [ ] Docker Compose + nginx TLS（Let's Encrypt）部署配置
- [ ] `POST /bridge/thoughts/capture`（bridge 模式录入新想法）
- [ ] `/chat` 速率限制（每分钟 N 次，防预算快速耗尽）
- [ ] Budget 超限 Tauri 事件通知（下次 UI 刷新时提示）
- [ ] 断线自动重试（bridge 客户端指数退避）

## 8. 成本估算

| 项目 | 费用 |
|------|------|
| VPS（小规格，需持久化存储） | ¥15-25/月 |
| 域名 + SSL | ¥0（Let's Encrypt / Cloudflare） |
| LLM API（可选，仅 /chat） | 用户自备 key，有硬预算上限 |
| **面向用户订阅价建议** | **¥20-30/月**（覆盖成本 + 少量利润） |

## 9. 已决策项

### 2026-04-17（初版，基于 wechaty 假设）

| # | 决定 | 理由 |
|---|------|------|
| 1 | **设备码配对** | 零运营成本，不做账号系统 |
| 2 | ~~纯透传 E2E 加密~~ → 见 2026-04-17b 修正 | — |
| 2a | ~~离线时预设自动回复模板~~ → 见 2026-04-17b 修正 | — |
| 3 | **暂不做多设备同步** | 单设备覆盖 90% 场景，CRDT 复杂度高，留到 M5+ |
| 4 | ~~先用 wechaty web 协议~~ → 见 2026-04-17b 修正 | — |

### 2026-04-17b（架构认知修正）

**背景：** 阅读 `src-tauri/src/commands/bridge_cmds.rs` 和 `echomind-wechat/src/wechat/` 后发现，现有实现用的是**微信官方 iLink Bot 协议**（`ilinkai.weixin.qq.com`），不是 wechaty。这使大量前期假设失效。

| # | 决定 | 理由 |
|---|------|------|
| 2 (修) | **不做 E2E 加密微信消息** | iLink 本身就是腾讯服务器中转，对 VPS 做 E2E 防一个已不存在的威胁。真正要保护的是想法库/对话库（本来就只在本地） |
| 2a (修) | **离线回复分档：A 模板 / B Persona 胶囊 + LLM / C 全云端 AI** | 用户可选；默认 A，启用 B 需主动配置胶囊 + LLM key |
| 4 (修) | **协议确定为 iLink Bot**（不再考虑 wechaty） | 官方协议，无封号风控；bot_token 无状态，天然适合上云 |
| 5 | **云桥 MVP：复用现有 `echomind-wechat/` 代码直接上云** | 已经能跑，只需加 HTTP/WSS 接口和鉴权层 |
| 6 | **不用 Redis**，用文件缓存（state.json + pending.jsonl） | iLink 长轮询自带游标，无状态重启友好；Redis 是过度设计 |
| 7 | **离线 LLM 用"用户自备 key 加密存 VPS"** | 相比 EchoMind 托管 key 更符合零知识原则，相比本地签发短期凭证更实用（本地离线时无法签发） |
| 8 | ~~Persona 胶囊起步做全局一份~~ → 见 2026-04-17c 修正 | — |
| 9 | **LLM 预算硬上限默认 $1/天** | 防 key 被劫持烧钱 |

### 2026-04-17c（场景认知修正：bot 是单人工具）

**背景：** 阅读 `echomind-wechat/src/commands/router.ts` 后确认 bot 的真实用途是**用户本人用手机 WX 远程操作自己的第二大脑**（录想法 / `/list` / `/search` / `/chat`），**不涉及朋友对话**。之前关于 Persona 胶囊 + 代朋友回复的设计全部作废。

| # | 决定 | 理由 |
|---|------|------|
| 2a (再修) | **删除离线 AI 自动回复整个方案**（A 模板/B 胶囊/C 全云端 全废） | 场景错误，bot 不代用户回朋友 |
| 7 (再修) | **LLM key 用途改为"在 VPS 上代执行 /chat 命令"**，非离线自动回复 | /chat 是用户主动触发，不是被动回复朋友 |
| 8 (再修) | **Persona 胶囊整体废弃** | 不需要假扮用户回复 |
| 10 | **WX Bridge 采用 Obsidian Sync 模式**：明确付费 + 知情同意 + 用户选上云范围 | 停止假装"既要方便又要零知识"。iLink 本就是腾讯服务器，上云不加剧根本性隐私问题；让用户自己决定哪些想法值得上云 |
| 11 | **VPS 持有"上云子集"完整数据**（不是只做代理） | 本地关机时手机 bot 仍全功能可用——这是付费买到的核心价值 |
| 12 | **上云子集规则由用户自选**（时间窗 / 标签 / 来源组合） | 不设默认硬编码范围，尊重用户控制力 |
| 13 | **停止订阅 = VPS 数据立即销毁** | 用户可随时退出，无锁定 |

## 10. 三层架构视图（Obsidian 风格）

参考 Obsidian 的"本地优先 + 可选付费扩展"模式，EchoMind 重构为三个独立可选模块：

| 层 | 名称 | 必选？ | 状态 | 月成本 |
|----|------|--------|------|--------|
| L1 | **EchoMind Core**（想法/对话/AI/Skills） | ✅ 必装 | 已完成 | 0 |
| L2 | **EchoMind Bridge**（手机 WX 远程使用第二大脑） | ⚪ 可选，订阅制 | 🟡 本地版已有，云端版待做 | ¥20-30 |
| L3 | **EchoMind Sync**（多设备桌面端同步） | ⚪ 可选，订阅制 | ⚪ 未开始 | ¥30 |

**关键原则（修正后）：**
- Core 永远免费且全功能离线可用
- Bridge / Sync 独立开关，互不依赖，各自订阅
- **Bridge 不是零知识**：用户知情同意"上云子集"会过腾讯 + VPS（类 Obsidian Sync 的坦诚模式）
- **Sync 是零知识**：E2E 加密，服务器看不见内容（未来实现）
- 退订即销毁云端数据，本地数据永不受影响

**实现优先级：** Bridge 先于 Sync。Bridge 解决"在外面用手机也能管第二大脑"这个刚需；Sync 解决"多台电脑"这个次要需求。

## 11. Bridge Server API 速查

所有受保护路由需 `Authorization: Bearer <JWT>` 头。管理路由需 `x-admin-token: <ADMIN_TOKEN>` 头。

### 公开路由

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| POST | `/bridge/pair` | 消费配对码，返回 JWT |

### 受保护路由（JWT）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST/GET | `/bridge/config` | 上传/查询设备配置（bot_token、子集规则、LLM 配置、预算） |
| POST | `/bridge/thoughts/upsert` | 批量上传想法（含可选向量） |
| POST | `/bridge/thoughts/delete` | 批量删除想法 |
| GET | `/bridge/thoughts` | 列出最近 N 条想法（`?limit=N`） |
| POST | `/bridge/thoughts/search` | 关键词搜索想法 |
| POST | `/bridge/chat` | 远程 LLM 执行（消耗预算） |
| GET | `/bridge/status` | 查询 LLM 用量/预算/禁用状态 |
| POST | `/bridge/terminate` | 销毁设备所有数据并解绑 |

### 管理路由（Admin Token）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST/GET | `/admin/pair-codes` | 生成/列出配对码 |
| DELETE | `/admin/pair-codes/{code}` | 撤销配对码 |
| GET | `/admin/devices` | 列出所有设备 |
| GET | `/admin/audit` | 查看审计日志 |
| POST | `/admin/devices/{id}/usage-reset` | 重置设备 LLM 用量并重新启用 |
| POST | `/admin/devices/{id}/budget` | 设置/清除设备预算上限 |

### echomind-wechat Bridge 独立模式

```bash
# VPS 上独立运行 bot（不依赖本地 EchoMind 桌面）
export ECHOMIND_BRIDGE_URL=https://bridge.example.com
export ECHOMIND_BRIDGE_TOKEN=<桌面配对后得到的 JWT>
node dist/main.js daemon
```

支持的 Bot 命令（bridge 模式）：`/list`、`/search`、`/view`、`/chat`、`/exit`、`/status`、`/help`
不支持：直接发文字录入想法（需桌面在线，或等 Phase 4 的 `/bridge/thoughts/capture`）。

## 12. 决策日志（迭代记录）

格式：`YYYY-MM-DD | 变更 | 原因`

- **2026-04-17** | 初始决策（§9 全部 4 项）+ 确定三层架构视图（§10）| 与 Obsidian 模式对齐，明确隐私边界和付费模块边界
- **2026-04-17b** | 架构认知修正：实现用的是 iLink 官方协议（非 wechaty）| 重写 §1 架构图、§5.1 daemon 技术栈、§5.3（删 Redis）、§5.4（加入胶囊/LLM key 推送）、§5.5（新增 Persona 胶囊 + 离线 LLM 详细设计）、§6（删风控 → 改 iLink 注意事项）、§7（重排 Phase）、§8（成本 ¥40→¥10）、§9 新增 5–9 号决策 |
- **2026-04-17c** | 场景认知修正：bot 是单人工具（你用手机 WX 操作自己的第二大脑），**不**涉及朋友对话。采用 Obsidian Sync 模式：明确付费 + 知情同意 + 用户选上云范围 | 作废 §5.5 Persona 胶囊整节改为"上云子集规则"、§2 核心原则重写（不再假装零知识）、§4 隐私边界加入知情同意提示、§5.1 daemon 加入 echomind-server + 子集 SQLite、§5.4 配对流程加入 subset_rules、§7 重写 Phase（去掉 Persona 相关、加入子集同步）、§8 成本 ¥10→¥15-25（需存储）、§9 新增 10–13 号决策、§10 三层描述修正（Bridge 非零知识） |
