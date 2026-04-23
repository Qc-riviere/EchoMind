# EchoMind 演进路线

> 六阶段演进：图谱 → Agent → Skills → **Bridge 云端化** → 导出 → Plugin。
> 原五阶段基础上插入 Bridge 云端化作为优先项——它把产品从"电脑开着才能用"升级为"手机随时用"，也是第一个付费触点。

---

## 阶段 1：Embedding 图谱（M1）✅ 已完成

### 目标
新建 `/graph` 页面，把所有灵感的 embedding 渲染成力导向图。新灵感 enrich+embed 完成后自动加入图谱（动态更新）。

### 后端
- `db/vectors.rs`
  - `get_all_embeddings() -> Vec<(String, Vec<f32>)>`
  - `find_neighbors(thought_id, k) -> Vec<(String, f32)>` 基于 sqlite-vec KNN
- `lib.rs`
  - 类型 `GraphNode { id, label, domain, tags, created_at, content_length }`
  - 类型 `GraphEdge { source, target, weight }`
  - 类型 `GraphData { nodes, edges }`
  - `get_embedding_graph(threshold, max_edges_per_node) -> GraphData`
  - `get_thought_neighbors(id, k) -> Vec<GraphEdge>`
- `commands/thought_cmds.rs` + `lib.rs`
  - 注册 `get_embedding_graph` / `get_thought_neighbors`

### 前端
- 依赖：`react-force-graph-2d`
- `pages/GraphPage.tsx` — 渲染图谱、节点点击打开 ThoughtDrawer
- `stores/graphStore.ts` — 缓存图数据 + 增量插入
- `stores/thoughtStore.ts` — `enrichAndEmbed` 完成后调 `graphStore.addNodeIncremental`
- `components/Sidebar.tsx` — 加 `/graph` 入口
- `App.tsx` — 加路由

---

## 阶段 2：LLM Agent + Tool Calling（M2）✅ 已完成（含 Gemini 实测验证）

### Trait 改造
`echomind-core/src/llm/mod.rs`
```rust
pub struct Tool { name, description, parameters_schema: Value }
pub struct ToolCall { id, name, arguments: Value }
pub enum AgentEvent { TextDelta(String), ToolCall(ToolCall), ToolResult{id, result}, Done }

trait LLMProvider {
    async fn complete_with_tools(messages, tools, config) -> Result<...>;
}
```
三家 provider 各自实现。Gemini 需要 `to_gemini_schema()` 做类型转换（小写 → 大写 + 剔除 default/additionalProperties）。

### Tool registry
`echomind-core/src/agent/`
- `tools.rs` — 内置 tools：`search_thoughts`, `get_thought`, `create_thought`, `update_thought`, `list_recent_thoughts`
- `mod.rs` — `run_agent(messages, tool_registry, max_iter) -> stream<AgentEvent>`

### 验收
- ✅ Gemini：2026-04-17 实测通过
- 🟡 OpenAI / Claude：代码层无需改（schema sanitization 在 parse_skill 层兜底），待真实 key 跑通确认

---

## 阶段 3：Skills 系统（M3a）✅ 已完成

### Skill 格式
```markdown
---
name: expand-to-blog
description: 把灵感扩写成 800 字博客草稿
trigger: manual | auto | both
parameters:
  format:
    type: string
    default: bullets
---
你是写作助手...
```

### 已实现能力
- Markdown + YAML frontmatter 解析（`echomind-core/src/skills/mod.rs`）
- 参数类型白名单（非法值自动回退 `string`）
- Auto/both 触发的 skill 自动注册为 agent tools
- Manual 触发：ChatHubPage 闪电按钮 → 在输入框光标位置插入 `/skill:name `
- Settings 管理页：列表 + 内联编辑器 + 删除 + 创建
- 扫描外部 AI 工具目录（~/.claude、~/.cursor、~/.codex、~/.windsurf）导入
- 内置 5 个默认 skill（summarize / analyze / brainstorm / rewrite / translate）

---

## 阶段 4：Bridge 云端化（L2）🔴 **下一步**

> 详细架构：`docs/architecture-hybrid-cloud.md`
> 定位：Obsidian Sync 式付费订阅，用户知情同意后把"上云子集"推到 VPS，实现 7×24 手机可用。

### 现状对比

| 项 | 当前（本地版） | 目标（云端版） |
|---|---|---|
| Daemon 运行位置 | Tauri 子进程（`std::process::Command::new("node")`） | VPS 独立进程 |
| 电脑关机 | bot 立即断线 | bot 照常工作 |
| 数据可见范围 | 完整本地主库 | 用户自选的上云子集 |
| 付费状态 | 免费 | 订阅（¥20-30/月） |

### Phase 1：VPS 端（5-7 天）
- [ ] Docker 化 `echomind-wechat/` daemon
- [ ] 轻量版 `echomind-server` 容器镜像（只服务子集 API）
- [ ] HTTP/WSS 接口：
  - `POST /bridge/config`（bot_token + sync_key + subset_rules + 可选 LLM 配置）
  - `POST /bridge/thoughts/upsert`（本地推送子集）
  - `POST /bridge/thoughts/delete`
  - `POST /bridge/terminate`（退订即销毁）
- [ ] JWT 鉴权中间件
- [ ] 子集 SQLite + 向量索引自动维护
- [ ] 定时任务：时间窗过期自动清理

### Phase 2：本地对接（5-7 天）
- [ ] Rust WSS 客户端（`tokio-tungstenite`），新模块 `echomind-core/src/bridge/`
- [ ] Bridge 设置页：订阅开关 + 子集规则编辑器 + 知情同意提示
- [ ] 子集规则引擎：想法写入/修改/删除时判定 + 差量推送
- [ ] 首次部署：初始全量上传（按规则过滤）
- [ ] UI 连接状态 + 云端存储用量指示器

### Phase 3：/chat LLM 转发（3-5 天）
- [ ] 本地可选推送 LLM key 到 VPS（加密，默认不推）
- [ ] VPS 执行 /chat 时调用配置的 LLM
- [ ] 预算硬上限 + 超额停用 + 通知本地

### Phase 4：稳定性与管理（可选）
- [ ] 断线自动恢复 + 监控告警
- [ ] 云端轻量 Web UI（订阅状态、用量、清空按钮）
- [ ] bot_token 重新扫码入口
- [ ] 一键销毁云端数据

---

## 阶段 5：导出（作为 Skills 实现）（M3b）

### 新 tools（暴露给 agent）
- `print_to_pdf` — 前端 `window.print`
- `write_docx` — Rust `docx-rs`
- `write_pptx` — 先用 sidecar 或简单模板
- `write_md` — 字符串拼接

### 导出 skills
- `export-md.md`
- `export-pdf.md`
- `export-docx.md`
- `export-pptx.md`（LLM 先生成 outline）

### UI
ChatHubPage 顶部加导出下拉菜单，触发对应 skill。

---

## 阶段 6：Obsidian 风格 Plugin 系统（M4）

### 目录
```
{appData}/plugins/
  my-plugin/
    manifest.json  { id, name, version, main }
    main.js
    styles.css
```

### Plugin 基类
```ts
export abstract class EchoMindPlugin {
  app: App;
  abstract onload(): Promise<void>;
  abstract onunload(): Promise<void>;
}
```

### Host API（`app` 对象）
- `app.thoughts` — list/get/create/update/archive/search
- `app.chat` — sendMessage / stream
- `app.skills` — register / invoke / list
- `app.ui` — addRibbonIcon / addCommand / addSettingTab / openModal
- `app.workspace` — getActiveThought / on('thought-created')
- `app.graph` — addNodeRenderer / addLayout
- `app.export` — registerFormat
- `app.vault` — readFile / writeFile（限插件目录）

### 加载器
- 启动扫描 `plugins/` 目录
- 读 `data.json` 看启用列表
- 用 Vite dynamic `import()` 加载 ESM
- 实例化 → 调 `onload()`

### UI
- Settings 加 "Plugins" tab
- Hello-world 示例 plugin 验证机制

---

## 后续规划（优先级低）

### L3 Sync（多设备桌面端同步）
- E2E 加密，服务器零知识
- CRDT 冲突合并
- 订阅制（¥30/月）
- **独立于 Bridge**，不依赖也不冲突

---

## 待清理事项

| # | 项 | 优先级 |
|---|---|---|
| 1 | OpenAI / Claude 工具调用实测（代码层无需改） | 低 |
| 2 | M2.8 Agent 手动测试 — 用真实 key 验证 agent 调用内置工具 | 低 |
| 3 | TS 警告：ThoughtCard 未用 `timeAgo`、ArchivePage 未用 import、WeChatBridgePage 类型比较 | 最低 |

---

## 风险

| 风险 | 缓解 |
|---|---|
| react-force-graph 在 Tauri webview 性能 | ≤200 节点 OK，超出再换 WebGL ✅ 已验证 |
| 三家 LLM tool calling API 差异大 | 抽象层做厚一些 ✅ Gemini 已过 |
| Plugin 动态 import 在 Tauri 打包后 | 用 asset protocol 加载 + CSP 配置 |
| pptx 库缺失 | docx-rs 成熟；pptx 可走 Python sidecar |
| **iLink bot_token 过期** | daemon 检测 ret=-14 → 通知本地 → 引导重扫码 |
| **VPS 被攻破** | 子集数据有隐私代价（明确告知用户）；LLM key 有预算硬上限 |
| **用户误上传敏感想法** | 规则支持"排除标签"；提供"清空云端子集"一键按钮 |

---

## 里程碑

- **M1** 图谱页能跑，新灵感动态加入 ✅
- **M2** chat 是 agent，能调 tool ✅（Gemini 实测通过）
- **M3a** skill 系统 + 默认 skills + 外部导入 ✅
- **M3c** Bridge 云端化（Phase 1-3）🔴 **当前**
- **M3b** 导出 skills
- **M4** plugin 系统 + hello-world
- **M5** L3 Sync（多设备桌面同步）
