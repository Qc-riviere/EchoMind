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
5. VPS 签发 JWT（v0.3.5+ TTL=1年；v0.3.5 前 30 天），返回给本地
6. 本地存储 JWT，后续 WSS 连接自动认证
7. 本地按 subset_rules 做初次全量上传（子集范围内想法 + 向量）

后续使用（v0.3.5+ Sliding TTL）：
8. 每次成功 authed 请求，服务端在响应头塞 X-Refresh-Token = 新 1 年期 token
9. 桌面 BridgeClient 自动捕获 → 持久化到本地 settings → 下次请求用新 token
10. 一年内开过一次 App，token 自动滚动续期，永不过期

无需账号系统。bot_token 可随时重推（覆盖即迁移）。
退出方式两种（v0.3.5+）：
- **重置本地凭证**（保留云端数据）：仅清本地 token / device_id / 同步游标，VPS 数据不动。
  适合 token 出问题想换码重新绑定、或换设备但想继承原 device 数据。
- **终止订阅**（销毁云端数据）：调 /bridge/terminate，VPS 销毁该 device 的所有数据。
```

**Sliding TTL（v0.3.5 引入）**：v0.3.5 前 TTL 仅 30 天，强制用户每月 SSH 到 VPS 拿新码 +
重新配对，操作极其复杂。v0.3.5 改为初始 TTL 1 年 + 服务端每次成功认证 reissue 新 1 年期
token 塞响应头 `X-Refresh-Token`，桌面 Rust 客户端（`echomind-core/src/bridge/client.rs`）
自动读响应头写回 settings 表。**用户不再需要手动更新 JWT**——只要 1 年内打开过一次 App，
token 永远滚动续期。TS bot 客户端（`echomind-wechat`）暂未实现 refresh，理论上一年后需要
手动给 bot 重新发 token（步骤见 §11 末尾），后续计划在 TS 端也加 refresh-token 捕获以彻底
消除这道手动工。

**多设备共享同一份云端数据**：VPS 用 `data/devices/<device_id>.db` 一设备一库，device_id
由配对时的 `sync_key_fp` 决定（`pairing.rs` 中同 fp 复用同 device，不同 fp 建新 device）。
桌面 + VPS 上的 bot **必须用相同 sync_key_fp 配对**才能落到同一 device、共享同一份云端数据。
否则桌面 / bot 各自落到独立 DB，互不可见——表现为 bot 收到的消息桌面拉不到。桌面 UI 在
「设置 → 云桥 → 订阅状态」展示 `sync_key_fp` 可点击复制；bot 配对时用相同值即可加入
同一 device 命名空间。

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

**所有受保护路由的响应头都会带 `X-Refresh-Token: <新1年期JWT>`**（v0.3.5+ Sliding TTL），
桌面 Rust 客户端会自动读取并持久化到 settings 表。其他客户端可选实现 refresh 捕获以避免
长期手动更新 token。

### 公开路由

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| POST | `/bridge/pair` | 消费配对码，返回 JWT（TTL=1年） |

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

**独立 bot 模式 token 更新**（v0.3.5+ 一年一次；将来 TS 客户端实现 refresh 后取消）：

```bash
# 1. 在 VPS 上申请新 pair-code
ADMIN_TOKEN=$(grep -oP '^ADMIN_TOKEN=\K.*' .env)
CODE=$(curl -s -X POST https://bridge.example.com/admin/pair-codes \
  -H "x-admin-token: $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"ttl_secs": 600}' | grep -oP '"code":"\K[^"]+')

# 2. pair —— sync_key_fp 必须与桌面端相同（否则 bot 落到独立 device，互不可见）
#    桌面 fp 在「设置 → 云桥 → 订阅状态」可见
curl -X POST https://bridge.example.com/bridge/pair \
  -H "Content-Type: application/json" \
  -d "{\"device_code\":\"$CODE\",\"sync_key_fp\":\"<桌面相同的 fp>\"}"
# → {"token":"eyJ...","device_id":"dev_..."}  # device_id 应等于桌面 device_id

# 3. 写入 .env 并重启 bot
sed -i 's|^ECHOMIND_BRIDGE_TOKEN=.*|ECHOMIND_BRIDGE_TOKEN=<新token>|' .env
docker compose up -d bot
```

## 12. 决策日志（迭代记录）

格式：`YYYY-MM-DD | 变更 | 原因`

- **2026-04-17** | 初始决策（§9 全部 4 项）+ 确定三层架构视图（§10）| 与 Obsidian 模式对齐，明确隐私边界和付费模块边界
- **2026-04-17b** | 架构认知修正：实现用的是 iLink 官方协议（非 wechaty）| 重写 §1 架构图、§5.1 daemon 技术栈、§5.3（删 Redis）、§5.4（加入胶囊/LLM key 推送）、§5.5（新增 Persona 胶囊 + 离线 LLM 详细设计）、§6（删风控 → 改 iLink 注意事项）、§7（重排 Phase）、§8（成本 ¥40→¥10）、§9 新增 5–9 号决策 |
- **2026-04-17c** | 场景认知修正：bot 是单人工具（你用手机 WX 操作自己的第二大脑），**不**涉及朋友对话。采用 Obsidian Sync 模式：明确付费 + 知情同意 + 用户选上云范围 | 作废 §5.5 Persona 胶囊整节改为"上云子集规则"、§2 核心原则重写（不再假装零知识）、§4 隐私边界加入知情同意提示、§5.1 daemon 加入 echomind-server + 子集 SQLite、§5.4 配对流程加入 subset_rules、§7 重写 Phase（去掉 Persona 相关、加入子集同步）、§8 成本 ¥10→¥15-25（需存储）、§9 新增 10–13 号决策、§10 三层描述修正（Bridge 非零知识） |
- **2026-05-12** | 协议名称澄清 + 灰度卡点全景盘点 | (1) 全文涉及"iLink"语境恰当上下文化为「微信 ClawBot（产品名）+ iLink 协议（底层）+ `@tencent-weixin/openclaw-weixin` npm 包（腾讯官方 scope）」；(2) H8 商业化风险整段推翻——这是 2026 腾讯官方放开协议，无商用风险；(3) 新增 §13「公开发布前卡点清单」，按 P0/P1/P2 分级 |
- **2026-05-12** | P0 #1 + #2 落地 | (1) 新增 `.github/workflows/desktop-release.yml`：tauri-action 矩阵 build Windows + macOS universal，push tag `v*` 触发，产物推 Release 草稿；(2) 复盘发现 `.github/workflows/docker-publish.yml` 已存在并覆盖 bridge-server + wechat 两个镜像，P0 #2 实际已完成，§13 卡点清单更新状态 |
- **2026-05-12** | P0 全部清完 / Alpha-ready | (1) `v0.1.0-rc1` tag 触发 desktop-release，macOS + Windows 双 job 14m+ 通过；(2) 复盘 P0 #3 `/bridge/thoughts/capture` 路由实际已实现（routes.rs:28 + bridge-client.ts:68），enrich/embed gap 降为 P1 #11b；(3) 复盘 P1 #9 测试 LLM 按钮已在 SettingsPage 存在；(4) 新增 `src/components/Onboarding.tsx` 4 步首次启动引导（欢迎 → LLM 配置+测试 → 第一条灵感 → 微信桥 teaser），`App.tsx` 加 OnboardingGate 自动触发；(5) §13 加 Alpha 就绪度评估表，结论：Alpha 招募已可启动 |
- **2026-05-13** | UI/UX 体系性整顿 + P1 路线锁定 | 通过 ui-ux-pro-max skill 全 app review，按优先级 1→10 整改：(1) 全局字号下限 11px（96 处 9-10px 批改）；(2) Sidebar/MainLayout/SettingsPage 全中文化，删 MainLayout 假搜索/假图标；(3) prefers-reduced-motion 媒体查询；(4) HomePage 主列表改全量分页 9/页 + HotChats 移右栏直跳对话 + 滚动复位。同时锁定 Alpha 前 P1 执行顺序 A→E（先错误翻译层，再 a11y，再 bridge enrich，最后 e2e + 文档） |
- **2026-05-13b** | P1 #7 / #11b / a11y 三连清 + UX 修复一组 | (A) `src/lib/errorMsg.ts` 集中错误翻译层，11 文件 27 处替换；(B) 全局 `:focus-visible` outline CSS + TitleBar/SummaryModal/ThoughtDrawer/ThoughtInput/ChatPage 关键图标 aria-label，ChatPage 删 2 个死按钮 + Drawer 4 操作按钮中文化；(C) `bridge_sync_pull` 检测新 inserted 且 domain/tags 空时自动 enrich+embed，CaptureWindow / SummaryModal「保存」也补齐 enrich；(D) WeChatBridgePage 云桥模式横幅，不再误报「未启动」；(E) 多选交互重做——卡片右上 ⋯ hover 自动变 ☐ 复选框，删丑大圆圈和「多选模式」开关，SelectionBar 自动按 selectedIds.size 显示；(F) ThoughtDrawer.handleReanalyze 成功后清 enrichErrors，红框不再赖在分析过的卡片上 |
- **2026-05-13c** | 搜索可用性 + 视觉品牌 + 国际化收口 | (A) 搜索在 Claude/DeepSeek 等无 OpenAI 兼容 embedding 端点的 provider 下整体不可用——`load_embedding_config_from_conn` 兜底分支把 LLM key 直接发到 OpenAI 端点必 401；改为仅 `openai` / `gemini` 走对应远端，其它 provider 自动 fallback 到本地 bge-small-zh-v1.5 (512 维)；(B) `reembed_all_thoughts` 在 re-embed 前比对 `thought_embeddings` 虚表当前维度与目标维度，若不一致 DROP + 重建（修 1536 → 512 切换时的 `Dimension mismatch`）；(C) 图标品牌色与 App 主色统一——`public/logo.svg` 紫 `#8b5cf6` → 蓝 `#adc7ff`（`--t-primary`），`pnpm tauri icon` 重生所有 .ico/.icns/.png（Win + iOS + Android 全套）；(D) GraphPage 节点 label 硬编码 `rgba(0,0,0,0.75)` 在暗色下不可见 → 根据 theme store 选浅/深色；同步加色彩图例 overlay（绿 = 近 24h，其余按 domain），头部 + tooltip + 空态全中文化；(E) SettingsPage 残留英文清零——LLM / Embedding / AI / Skills / Appearance / Data / About 7 个 tab 的 section 标题、字段标签、按钮、对话框、placeholder 全部汉化，仅保留品牌名与 `API Key` / `Temperature` / `Base URL` 通用术语 |
- **2026-05-18** | 图谱配色修复 + 云桥配置降噪 | (A) 图谱所有节点显灰色——根因：`enrich_thought` system_prompt 让 AI 返回 `"domain": "一个领域词"` 完全开放词表，中文 prompt 下 AI 返回 `工作` `学习` `AI` 等任意串，而前端 `DOMAIN_COLORS` 只有 10 个英文 key（technology / science / …）→ 不匹配全部 fallback 灰。修法两路并行：① GraphPage 加 `hashColor()` HSL fallback——未在 lookup 表里的 domain 按字符串 hash 出稳定柔和色（同 domain 永远同色），存量数据立即上色；② echomind-core lib.rs system_prompt 把 domain 字段限定为 11 个英文 enum（10 类 + other），未来新数据走预设色保持图例准确性；图例底部加"其他主题：按名称自动配色"说明。(B) CloudBridgePage 信息密度过高（第一屏 5 大块挤一起：知情同意 4 条警示 + 配对 + 订阅状态 + 子集规则 + LLM 远程 + 危险区）→ 3 个次要 section 全部包 `<details>` 默认折叠（上云子集规则 / LLM 远程执行 / 危险区），第一屏只剩订阅状态主卡 + 主开关；PairForm 4 条详细警告折进"详细说明"，主面板留一句话隐私代价摘要 + 同意框。无功能变更，纯视觉降噪。 |
- **2026-05-13d** | ChatPage 导出 + MVP 报告补两章 | (A) ChatPage 顶右浮动「导出 ▾」下拉对齐 SummaryModal 模式，支持 Markdown / DOCX（`docx` npm）/ PDF（`window.print()`）三种格式；新 helper `src/lib/chatExporters.ts` 复用 SummaryModal 的 buildMarkdown / buildDocxBlob 形态、改写为对话消息形状（过滤 withdrawn + system，附关联灵感 header）；输入条 / 资源面板 / 撤回按钮加 `print:hidden`，打印输出干净；(B) `EchoMind_MVP汇报报告.md` 新增 §二「App 内置的 AI Agent 系统」（披露 `agent/mod.rs:71` 的 `run_agent` 工具调用 loop + 5 个内置工具 + Skills System 用户扩展 + 三家 provider 的 `complete_with_tools` 抽象 + 隐私相关路由 + 哪些产品功能走 agent / 哪些不走）+ §三「数据流通与隐私边界」（数据流向矩阵 + 5 个用户开关 + 5 件 NOT 做的事 + 与 Obsidian Sync 隐私模型对比），后续章节统一重编号；(C) 报告版本 v0.1 → v0.2、日期 2026-05-12 → 2026-05-13 |
- **2026-06-03 (v0.3.7-dev)** | D23 App i18n（UI 英文化）全 5 phase 收口 | 公开发布前提条件：英文用户能用。架构：`react-i18next` 26.3.0 + JSON resource bundles（`src/i18n/locales/{zh,en}.json`），dual persistence——localStorage 拿 first-paint 同步初值 / SQLite `settings.ui_locale` 是 authoritative，`main.tsx` 启动后 reconcile（DB 比 LS 新则覆盖 LS），SettingsPage Appearance tab 暴露 zh/en 切换按钮即时切换 + 落 DB。**Phase 1** infra + Settings tabs PoC（`da9f803`）。**Phase 2** 前端 UI 全 sweep 6 batch ~430 strings：Sidebar/ConfirmDialog/ChatPlanModal/ThoughtCard（folder-fold 都进 t()）/ HomePage/ ChatHubPage/SearchPage/ArchivePage/CaptureWindow/ThoughtDrawer/ SettingsPage（含 SkillsTab + AppearanceTab 子组件各自挂 `useTranslation()` 避免 locale 切换无重渲染）/ CloudBridgePage + WeChatBridgePage / errorMsg 12 类错误 bundle（`81e5cf1` → `b8ffaf8`）。**Phase 2 bonus** 修了一个 latent bug——`lib/errorMsg.ts` 早就调 `i18n.t("errors.*")` 但 bundle 没对应 key，所有 LLM/network/quota 错误 toast 都在显示原始 key 字符串（`errors.bridge_jwt`），phase 2 batch 6 一并补齐。**Phase 4** LLM system prompts（`3ed1086`）：5 个短 prompt 全 EN 重写并加 `"Respond in the same language as the user's question"`，分别是 INTERROGATION（灵魂拷问）/ enrichment（自动 domain/tags/file_summary）/ resource recommender 两个变体（with-search + no-search）/ multi-thought summarize；huge `synthesize_chat_plan` ~100 行模板加顶层 `[Language]: detect user message lang + 翻译 section headings + 标签 (常识→common knowledge / 估算→estimate)` override，让 LLM 现场翻译；完整 EN 重写延后为 **D24**。**Phase 5** 排版 QA（`d1d8570`）：静态审 verdict 布局对 EN 1.5-2x 字长鲁棒，只加 Sidebar NavItem defensive `truncate min-w-0` + icon `shrink-0` 防未来 label 增长破 w-64 列。**未做（已记 D24/D25 留作 follow-up）**：phase 3（Rust 端 tray menu / notification body / bridge_cmds error returns 还是中文，对 EN 用户一致性差但不阻塞功能；plumb locale 到 Rust state vs 全部改 EN 二选一，等用户反馈）+ D24（synthesize_chat_plan 完整 EN 模板，bilingual override 大多数场景够用）。**EN tagline**：sidebar "Inspiration Notes"，nav 项中文 → English 全切，confirm dialog 默认中英按钮，chat plan 模态 export/save 按钮全 i18n。 |
- **2026-05-29 (v0.3.7-dev)** | N1 chat 时间戳 + N2 thread/follow-up phase 1-2 + Tavily-grounded 资源推荐 | (A) **N1**：ChatHubPage 每条 user/AI 消息渲染相对时间（"5 分钟前" / "今天 14:32" / "昨天 14:32" / "X 天前" / "YYYY-MM-DD"），hover 显完整 ISO；新建 `src/lib/relativeTime.ts` 两个工具复用给后续 N2 appendix cards。(B) **N2 phase 1**：thoughts 表加 `parent_id TEXT` 列 + `idx_thoughts_parent_id` 索引；SQLite ALTER TABLE 不能加 ON DELETE CASCADE，在应用层用递归 CTE 在 `delete_thought` 里 cascade 删除整棵子树；新增 `list_root_thoughts` / `list_children` / `list_descendants` / `find_root` / `latest_root_thought` / `create_child_thought` 查询；`list_thoughts`（AppCore 包装）改为只返 root，bridge sync / AI search / embedding 路径切到新 `list_all_thoughts` 保持全量可见。新 Tauri 命令：`append_to_thought` / `list_thought_children` / `list_thought_descendants` / `find_root_thought`。(C) **N2 phase 2**：`ThoughtCard` UI 完全按 Claude Design "Appendix Folder" bundle 重写（存档于 `outputs/design-bundle/`）——折叠态追加的灵感作为 peek 层（`position:absolute; inset:0; left/right: INSET_STEP(7)*d; transform: translateY(PEEK_OFFSET(5)*d); opacity: BACK_FADE(0.62)^d`）藏在主卡后方，z-index 递减；下方独立 "folder_copy · N 条追加 · expand_more" 药丸按钮（避免被主卡 `overflow-hidden + rounded-2xl` 截断 = 设计 chat 里发现的 bug 修复）；展开态每条 child 渲染为独立小卡，stagger 入场 `index×55ms` + `translateY(-14px) scale(0.97)` → 落位，depth opacity `max(0.32, 1-(d-1)*0.16)`，cubic-bezier(.22,1,.36,1)，关闭反向播放 380ms 后真正 unmount。chat 后端 `build_chat_system_prompt` 加 appendices 参数，3 个 chat 方法（complete/stream/agent）都注入 children content 让 AI 看完整 thread。**剩 phase 3-5**：微信 router 识别"补充：/追加："前缀 + bridge sync 协议带 parent_id + 集成测试。(D) **Tavily-grounded 资源推荐**：对话页右侧"相关资源"原走 LLM 凭记忆推荐 URL → 经典 hallucinated path 404；配 Tavily key 后改 grounded RAG：新模块 `echomind-core/src/web_search.rs` 调 `https://api.tavily.com/search` 拿 10 条候选 → 灌进 prompt → LLM 只能从候选 URL 里挑 3-6 条 + 写一句话相关性说明（system prompt 严格"禁止使用候选之外的 URL；候选不够 4 条宁可返回更少甚至空"）。没配 key fall back 旧 LLM-only 路径保持向后兼容。Settings 新 tab "联网搜索"（`travel_explore` 图标）：provider dropdown（Tavily-only）+ key 输入（show/hide 切换）+ 测试按钮（调 `test_web_search` Tauri 命令，跑 query="EchoMind sqlite vector search" max=3 的小搜索回报"✓ 连接成功 · 首条：xxx" 或 Tavily 错误原文：401 / 429 / 网络）。**为啥不走 MCP**：对单一 web_search 场景过度设计——要带 Node runtime（tavily-mcp 是 npm 包）+ rmcp Rust 客户端 + 子进程生命周期管理 + tool 规范翻译层，换来零新能力（tavily-mcp 内部也是同样的 HTTP POST，40 行 Rust 已完成同事）。MCP 价值在生态——多 server 可插拔（filesystem / GitHub / Notion / 用户自写）+ 让 EchoMind 自己也开 MCP server 端口供 Claude Desktop 读灵感库——列入 TODO **D15b** 作为 v0.5+ Plugin 系统的一部分。 |
- **2026-05-27 (v0.3.5)** | JWT Sliding TTL + 互通根因修复 + 文档反映现实 | **痛点**：v0.3.5 前桌面 + bot JWT 都是 30 天 TTL，过期后客户端每 5 秒刷一次 `[bridge-sync] 401 ExpiredSignature`，用户被迫每月 SSH 上 VPS 申请新 pair-code、重新配对——操作链长得离谱。修法：(A) 服务端 `routes.rs::pair` TTL 30d → 365d；(B) `auth.rs::require_auth` 改为 axum 中间件 before+after 模式——每次成功认证后 reissue 新 1 年期 token，塞响应头 `x-refresh-token`；(C) 桌面 Rust `BridgeClient` 加 `refreshed_token: Mutex<Option<String>>` slot + 新 helper `send_authed()` 自动捕获响应头；EchoMindCore 加 `persist_bridge_refresh(&client)` 把 slot 内容写回 `bridge_token` setting，所有 9 处 `bridge_client()` 调用方都在用完后 drain。**用户 1 年内开过一次 App，token 就永远滚动续期**。(D) 桌面后台 sync_pull 循环加错误去重 + 5min 退避——401 不再以 12 err/min 刷屏，3 行同款 error 只打一次。(E) CloudBridgePage 新增「重置本地凭证（保留云端数据）」按钮 + 暴露 `sync_key_fp` 可点击复制——之前 terminate 是唯一退出路径会顺手销毁 VPS 数据，对"只想换 token 重新绑定"场景过于暴力。**根因发现**：v0.3.5 上线后用户反馈 bot 收到的消息桌面拉不到——挖到 VPS 用 `data/devices/<device_id>.db` 一设备一库（`db.rs:41`），device_id 由 `sync_key_fp` 决定（`pairing.rs:138`，同 fp 复用同 device），之前文档没提这条关键约束、UI 也没暴露 sync_key_fp 字段，导致我让用户给 bot 用随机 sync_key_fp 重 pair 时落到独立 device 互不可见。修：UI 显示 + 复制按钮 + §5.4 文档明确"桌面与 bot 必须用相同 sync_key_fp"。**Embedding & 整理为方案副产**：(F) `load_embedding_config_from_conn` 兜底分支看 `llm_provider_preset` 优先于 `llm_provider`——之前 DeepSeek backend 名是 `openai`，兜底会拿 DeepSeek key 撞 OpenAI URL 401；现在 DeepSeek/Claude 等无自家 embedding 端点的 provider 自动 fallback 到本地 bge。(G) SettingsPage embedding 加 local/cloud 显式 selector，选 local 时清掉所有云端字段防残留。(H) `synthesize_chat_plan` 用户体验三连：errorMsg.ts JWT/bridge 分支前置（之前被通用 401 误诊为 "API Key 无效"）+ `complete_via_route_opts` 接受 max_tokens override（synthesize 用 8192 防中途截断）+ system prompt 重写允许 [常识]/[估算] 标签补行业知识 + 注入 6 维度推导框架（需求/技术/数据/AI模型/竞争/交付）让 LLM 输出对标 Claude feasibility-report skill 详细度。(I) ChatPage 孤儿文件删除（489 行）——`/chat` 和 `/thought/:id/chat` 路由都指 ChatHubPage，整理为方案按钮 a1e4fd0 误加到 ChatPage 永远不渲染；搬到 ChatHubPage chat header 右上。 |
- **2026-05-25 (v0.3.2)** | Plan A 完整落地：sidecar 打包 + Token 加密 + Tray/UX 三连 | **根因发现**：扫码连接在 packaged 安装包从未跑通——`echomind-server.exe` + Node runtime + `echomind-wechat/dist` 三个依赖一个都没进 bundle，dev 模式因为 `cargo build` + 本地 `node_modules` 都齐才"看起来正常"。修法：(A) **Sidecar 打包**——Bot 用 `bun build --compile` 编成单 .exe（95MB，零原生依赖，仅依赖 `qrcode` 纯 JS + `node:*` stdlib），与 `echomind-server.exe`（32MB）一并通过 `tauri.conf.json` 的 `bundle.externalBin` 进入安装包，Tauri 自动按 triple 命名 / 安装时去后缀。新增 `scripts/build-sidecars.mjs` 跨平台幂等脚本（cargo build server + bun --compile bot + 自动 `npm ci` 兜底 bot 子项目 deps）；CI 矩阵跑 Win 单 triple + macOS 双 arch。**Bot 子项目 npm ci 兜底是 CI 第一次跑挂的根因**——根 `pnpm install` 不下钻到 `echomind-wechat/`，于是 bun --compile 找不到 `qrcode`；fix 后 v0.3.2 tag 重打。(B) **Token 加密**——`echomind-server` 新增 `crypto.rs`（AES-256-GCM）+ `/api/token/{encrypt,decrypt}` 端点，密钥首次随机生成存 OS keychain（`keyring` crate，Win Credential Manager / macOS Keychain）；bot 的 `wechat/login.ts` 把 `accounts/*.json` 写入路径改成 `*.enc` envelope，`loadLatestAccount` 读 `.enc` 自动 decrypt、读到旧 `.json` 自动迁移并删除明文。(C) **Tray + 主窗 UX**——`TrayIconBuilder` 加右键菜单（显示主窗口 / 速记浮窗 / 退出 EchoMind），左键继续 fire click 显示主窗；主窗 `CloseRequested` 改 `hide()` + `prevent_close()`（之前 X 关 = App 退出，托盘也跟着没），首次关闭弹 Windows 通知告知"仍在后台"，用 setting `tray_close_hint_shown` 防重复。(D) **Splash 进度条**——`index.html` 内联深色 splash（logo + 进度条 + 文案），CSS keyframe 3s 平滑爬到 92%，`main.tsx` 在 React mount 后接力推到 100% 并 fade out；覆盖了从 Webview2 启动到 React 首屏的全部黑屏窗口。(E) **必要 hint**——TitleBar 三个窗口控制按钮加 `title` 解释实际行为（X 现在是"最小化到托盘"而非"关闭"），Sidebar 微信桥/云桥 hover title 区分本地 vs VPS 路径，WeChatBridgePage「扫码连接」按钮加副文案告知点击后会发生什么。 |

---

## 13. 公开发布前卡点清单（2026-05-12 盘点）

按"别人能不能用"维度按严重度排序。**P0 不解决 = 没人能用；P1 不解决 = 装了能用但流失高；P2 = Beta 前考虑**。

### P0 阻断性卡点

| # | 卡点 | 为什么阻断 | 解法 |
|---|---|---|---|
| 1 | ~~没有 release binary~~ ✅ | 普通用户没有 Rust 工具链 | `.github/workflows/desktop-release.yml`：push tag `v*` → matrix build Win + macOS universal → 推 GitHub Release（草稿） |
| 2 | ~~没有 bridge-server docker 镜像~~ ✅ | VPS 部署需要 `docker pull` | `.github/workflows/docker-publish.yml`：master push 触发，build & push `ghcr.io/qc-riviere/echomind-bridge:latest` + sha；同 workflow 也覆盖 `echomind-wechat` 镜像 |
| 3 | ~~`/bridge/thoughts/capture` 路由未实现~~ ✅ | 复盘发现实际已实现：bridge-server `routes.rs:28` 注册 + `bridge_capture_thought` handler + `store.capture_thought`；wechat bot `bridge-client.ts:68` + `handleBridgeCapture`（BRIDGE_MODE 默认文字走此路径）。**Gap → 降为 P1**：bridge 端 capture 后不做 enrich/embedding，列表看到的灵感无 domain/tags/向量；非阻断，仅劣化体验 |
| 4 | ~~新手 onboarding 缺失~~ ✅ | 用户装完 → 看到全英文 + 复杂 Settings → 不知道下一步 | `src/components/Onboarding.tsx` 4 步引导（欢迎 → LLM 配置+测试 → 第一条灵感 → 微信桥 teaser）；`App.tsx` 内 `OnboardingGate` 在 `!llm_api_key && !onboarding_completed && !onboarding_dismissed` 时自动弹；默认选 DeepSeek（最低门槛） |

### P1 体验劝退

| # | 卡点 | 影响 | 解法 |
|---|---|---|---|
| 5 | Mac Gatekeeper / Win SmartScreen 拦截 | 30%+ 用户在"右键打开"步骤直接弃用 | Beta 前买 Apple Dev $99/年；Win 暂用文档教程 |
| 6 | LLM Key 注册门槛 | 用户进 EchoMind 才发现"还要注册 DeepSeek 充值" | 文档给一键注册链接 + 充值 ¥10 即可指引；考虑首次启动赠送少量额度（需后端） |
| 7 | ~~错误信息不友好~~ ✅ | API 报错直接弹原始 stack | `src/lib/errorMsg.ts` 集中翻译层覆盖鉴权/额度/速率/模型/上下文/网络/Bridge JWT/5xx/文件/数据库 ~10 类，11 文件 27 处 `String(e)` → `errorMsg(e)` |
| 8 | 微信 ClawBot 扫码流程 UI 完整性未验证 | WeChatBridgePage 改了 step 状态机，e2e 是否死锁未知 | 自己重装走完整 onboarding 流程实测 |
| 9 | ~~没有"测试 LLM 连接"按钮~~ ✅ | 复盘发现已实现：`SettingsPage.tsx:175` 的 `handleTest`（"Test Connection" 按钮）+ onboarding Step 2 也复用同一接口 |
| 10 | Phase 4 剩余三项：`/chat` 速率限制 + 断线重连 + Budget 通知 | 失控调用耗预算 / 网络抖动数据不一致 / 用户预算耗尽不知情 | Phase 4 收尾，1-2 周 |
| 11b | ~~bridge capture 无 enrich/embed~~ ✅ | bridge 模式 `/list` 看到的灵感无 domain/tags/向量 | `bridge_sync_pull` 检测到新 inserted 且 domain/tags 为空时自动 enrich + embed；同 commit 也补齐了 CaptureWindow / SummaryModal「保存为新灵感」遗漏的 enrich 路径 |

### P2 长期改进

| # | 卡点 | 影响 | 解法 |
|---|---|---|---|
| 11 | 没有用户协议 / 隐私政策 | 合规必备，"知情同意"叙事需要文案落地 | 法律咨询 + 草拟 |
| 12 | 没有 Landing Page | 公开发布入口 | Vercel 部署 1 页 |
| 13 | 没有支付通道 | 收订阅必备 | Stripe + 国内 Pingxx，Beta 前接 |
| 14 | fastembed 模型首次下载 400MB+ | 国内 HuggingFace 不稳 | 文档提示 hf-mirror，长期可分发本地缓存 |
| 15 | 首次启动数据库迁移日志暴露 | console 一堆 ALTER TABLE，不专业 | 静默化 |

### 不算卡点（伪问题）

- ~~iLink Bot 协议合规风险~~：已澄清为腾讯官方协议（见 §12 2026-05-12 决策日志）
- ~~VPS 部署境内 vs 境外~~：境内 + Docker Compose 已规划
- ~~sqlite-vec 性能不够~~：理论值 OK，待基准

### 优先级路线

```
✅ 本周已清：
  ├── ✅ P0 #1  desktop-release.yml（v0.1.0-rc1 实跑通过，Win + macOS universal）
  ├── ✅ P0 #2  docker-publish.yml（bridge + wechat 双镜像，原已存在）
  ├── ✅ P0 #3  bridge capture 路由（复盘已实现，enrich gap 降为 P1 #11b）
  ├── ✅ P0 #4  新手引导（Onboarding.tsx 4 步流程）
  └── ✅ P1 #9  测试 LLM 连接按钮（Settings 已有 handleTest）

Alpha 招募前剩余 —— 执行进度：
  ├── ✅ A. P1 #7    错误信息翻译层（lib/errorMsg.ts，11 文件 27 处替换）
  ├── ✅ B. UI a11y  全局 focus-visible CSS + TitleBar/Modal/Drawer/ChatPage 关键 aria-label
  ├── ✅ C. P1 #11b  bridge capture 后 enrich + embed（bridge_sync_pull + capture/summary）
  ├── D. P1 #8    自己 e2e 走完 onboarding + 微信桥扫码，找漏修补 ← 用户侧
  ├── E. P1 #6    LLM Key 注册引导（onboarding 已附链接 → 加图文教程 docs）
  └──    P1 #5    Mac 代码签名（Apple Dev $99/年，需用户决定何时购买）

Beta 公开前：
  ├── P1 #10  Phase 4 剩余三项（速率/重连/Budget 通知）
  └── P2 #11-15 ToS / Landing / 支付 / fastembed 镜像 / 迁移日志静默

UI/UX 体系性改进（2026-05-13 通过 ui-ux-pro-max skill 完成）：
  ├── ✅ 全局字号下限 11px（96 处 sub-12px 修正）
  ├── ✅ Sidebar / MainLayout / SettingsPage 中文化（5-13c 收尾 7 个 tab 全清）
  ├── ✅ MainLayout 假搜索框 + 假图标按钮删除
  ├── ✅ prefers-reduced-motion 媒体查询
  ├── ✅ 全局 :focus-visible outline + TitleBar/Modal/Drawer 关键 aria-label
  ├── ✅ ChatPage 删 2 个死按钮 + send aria-label + placeholder 中文
  ├── ✅ Drawer 操作按钮中文化（重新分析 / 对话 / 归档 / 保存）
  ├── ✅ 多选交互重做：删丑大圆圈 + 卡片右上 ⋯ hover 即变 ☐，无需进入「多选模式」
  ├── ✅ WeChatBridgePage 云桥模式下显示「已通过云桥连接」横幅而非误报「未启动」
  ├── ✅ GraphPage 暗色下节点 label 可见 + 颜色图例 overlay + 头部 / tooltip / 空态中文化
  ├── ✅ 图标品牌色对齐 App 主色（紫 → 蓝 `#adc7ff`，重生 ico/icns/全平台 png）
  └── ✅ ChatPage 对话导出 MD / DOCX / PDF（与 SummaryModal 一致的下拉 + 打印 CSS）

可用性回归（2026-05-13c，潜伏 showstopper 修复）：
  ├── ✅ 搜索在 Claude/DeepSeek 等 provider 下整体不可用 → fallback 到本地 bge-small-zh-v1.5
  └── ✅ Reindex 1536 ↔ 512 维切换 `Dimension mismatch` → 检测维度不一致即 DROP + 重建 vec 表
```

详细的灰度发布操作步骤（VPS 部署、招募文案、反馈通道）见根目录 `EchoMind_MVP汇报报告.md` §7。

### 当前 Alpha 就绪度评估（2026-05-12 收尾）

| 维度 | 状态 | 说明 |
|---|---|---|
| 可安装 | ✅ | tag v* 自动 build Win .msi + macOS .dmg 到 Release |
| 可部署 bridge | ✅ | `docker pull ghcr.io/qc-riviere/echomind-bridge:latest` |
| Staging 实际运行 | ✅ | VPS 49.128.204.149 (1c1g) 已部署，Cloud Bridge + WeChat 双向互通验证通过（2026-05-12） |
| 首次能用 | ✅ | Onboarding 4 步引导覆盖 0 → 第一条灵感 |
| 核心功能完整 | ✅ | 速记 / 浏览 / AI 总结 / 对话 / 微信桥 / Cloud Bridge 全跑通 |
| 体验打磨 | ⚠️ | 错误信息已中文翻译 ✓ / 全局 a11y focus + aria-label ✓ / 多选交互重做 ✓ / 设置 7 tab 全汉化 ✓ / Graph 暗色 + 图例 ✓ / 图标品牌色对齐 ✓ / **Claude/DeepSeek 搜索可用性已恢复**（本地 embedding fallback）✓ ；剩 macOS 签名（用户需"右键打开"） |
| 商业化基础 | ❌ | 无 ToS / Landing / 支付（Beta 阶段再上） |

**结论**：Alpha 招募（≤30 种子用户 + BYO Key + 用户自备 VPS）**已可启动**。Beta 公开发布建议补完 P1 #5-#7 + 落地页。
