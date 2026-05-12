# EchoMind

灵感备忘录 · 跨设备记录 + AI 自动整理 + 偶尔深度对话

## 核心特性

### 记录
- **全局速记浮窗** — `Ctrl+Shift+I` 任何场景下唤出无边框小窗，Enter 保存，Esc/失焦自动隐藏。窗口常驻不可见，热键响应即时
- **托盘常驻** — 系统托盘图标 hover 显示「今日新增 N」，点击聚焦主窗
- **微信速记** — 手机微信发条消息即落库，桌面端 30s 内同步并发系统通知
- **AI 自动补全** — 上下文、领域、标签自动生成，无需手动整理

### 浏览
- **首页双列表** — 「最近 5」+「对话最多 5」，分别覆盖时间维度和注意力维度
- **置顶最重要的事** — 单条灵感可置顶到首页顶部，对应「人生当前主线」
- **语义检索** — 自然语言搜索历史想法
- **关联发现** — 新想法落库时自动提示相似历史

### 整理
- **多选 AI 总结** — 勾选 2–20 条灵感，AI 一键归纳为中心论点+要点。可保存为新灵感或导出 MD/DOCX/PDF
- **对话深挖** — 单条灵感开启对话，结构化框架引导思考；首页/侧边栏可回到任意历史会话

### 多端
- **微信桥接** — 手机微信远程操作第二大脑（本地 / VPS 两种模式）
- **云端同步** — 可选把筛选后的想法子集推送到 VPS，桌面关机也能用手机访问

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 19 + TypeScript + Vite + Tailwind CSS + Zustand |
| 桌面壳 | Tauri 2.0 (Rust) |
| 本地数据库 | SQLite + sqlite-vec（向量搜索） |
| LLM | OpenAI / Google Gemini / Anthropic Claude |
| 微信 Bot | Node.js daemon（基于腾讯官方 `@tencent-weixin/openclaw-weixin`，iLink 协议） |
| 云端桥服务 | Rust + axum + rusqlite（echomind-bridge-server） |

## 项目结构

```
src/                              # React 前端
├── components/                   # UI 组件
├── pages/                        # 页面（Home / Chat / Archive / Search / Settings
│                                 #       CloudBridge / WeChatBridge / ...）
├── stores/                       # Zustand 状态
└── lib/                          # 类型定义

src-tauri/                        # Tauri Rust 后端
├── src/
│   ├── commands/                 # Tauri 命令（thought / ai / chat / bridge）
│   └── lib.rs                    # 应用入口 + invoke_handler 注册
├── echomind-core/                # 可独立测试的核心库
│   ├── src/
│   │   ├── bridge/               # Cloud Bridge 客户端 + 规则引擎
│   │   ├── db/                   # 本地 SQLite（想法 / 对话 / 向量 / 设置）
│   │   ├── llm/                  # LLM 提供商抽象（OpenAI / Gemini / Claude）
│   │   └── lib.rs                # EchoMindCore 高层 API
│   └── Cargo.toml
└── echomind-bridge-server/       # VPS 桥接服务（独立可执行）
    ├── src/
    │   ├── auth.rs               # JWT 签发与验证
    │   ├── crypto.rs             # AES-256-GCM 加解密
    │   ├── db.rs                 # 每设备 SQLite（上云子集 + 向量）
    │   ├── llm.rs                # 远程 LLM 转发（OpenAI / Claude / Gemini）
    │   ├── pairing.rs            # 配对码 + 设备管理 + 预算跟踪
    │   ├── routes.rs             # axum 路由
    │   └── state.rs              # 共享状态
    └── Cargo.toml

echomind-wechat/                  # 微信 Bot daemon（Node.js）
├── src/
│   ├── commands/router.ts        # 命令路由（本地模式 + bridge 独立模式）
│   ├── echomind/
│   │   ├── client.ts             # 本地 EchoMind 服务器 HTTP 客户端
│   │   └── bridge-client.ts     # VPS Bridge 服务器 HTTP 客户端
│   ├── wechat/                   # 微信 ClawBot 封装（腾讯官方 iLink 协议）
│   └── session.ts                # 用户会话管理
└── package.json
```

## 快速开始

### 前置要求

- Node.js 18+
- Rust 1.70+
- pnpm

### 本地开发

```bash
pnpm install
pnpm tauri dev
```

### 构建

```bash
pnpm tauri build
```

首次使用在设置页面配置 LLM API Key（支持 OpenAI / Gemini / Claude）。

---

## 微信桥接（可选）

> EchoMind 接入的是 **腾讯 2026 年官方放开的个人号 Bot API**——产品名 **微信 ClawBot**，底层协议 **iLink（智联）**，npm 包 [`@tencent-weixin/openclaw-weixin`](https://www.npmjs.com/package/@tencent-weixin/openclaw-weixin)（腾讯官方 scope）。
>
> **无封号风险、无商用限制**。bot 是独立 contact 加入用户微信，主号完全不受影响。区别于 wechaty / PadWechat 等已被禁的第三方协议。
>
> 背书链接：[GitHub Tencent/openclaw-weixin](https://github.com/Tencent/openclaw-weixin) · [OpenClaw 官方文档 - WeChat Channel](https://docs.openclaw.ai/channels/wechat)

### 本地模式（桌面需在线）

1. 在 WeChat Bridge 页面点击"启动微信桥"
2. 桌面 daemon 自动调起腾讯官方 CLI（`@tencent-weixin/openclaw-weixin-cli`）弹出二维码
3. 用自己的微信扫码授权，CLI 自动拿到 bot_token 并保存
4. 手机微信发消息给 bot 即可操作第二大脑

Bot 命令：`/list`、`/search <词>`、`/view <ID>`、`/chat <ID>`、`/archive <ID>`、`/status`、`/help`

`/chat` 回复带耗时尾注（`⏱ 1.8s`），便于判断模型响应速度。直接发文字（不带斜杠）即新建一条灵感，桌面端 30s 内拉到并弹系统通知。

### 云端模式（VPS 独立运行，桌面离线也可用）

需要自备 VPS，部署 `echomind-bridge-server`，详见 [VPS 部署](#vps-部署)。

配对后在 Cloud Bridge 页面推送想法子集和可选的 LLM 配置；VPS 上的 echomind-wechat daemon 通过环境变量 `ECHOMIND_BRIDGE_URL` + `ECHOMIND_BRIDGE_TOKEN` 独立运行。

---

## VPS 部署

### 使用 Docker Compose（推荐）

```bash
git clone <this-repo>
cd echomind-bridge-server

# 生成密钥
echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env
echo "ADMIN_TOKEN=$(openssl rand -hex 16)" >> .env
echo "ENCRYPTION_KEY_HEX=$(openssl rand -hex 32)" >> .env

docker compose up -d
```

详见 [`deploy/`](deploy/) 目录中的 `docker-compose.yml` 和 nginx 配置。

### 配置说明

| 环境变量 | 说明 | 默认值 |
|---|---|---|
| `BIND_ADDR` | 监听地址 | `0.0.0.0:3000` |
| `DATA_DIR` | 数据目录 | `./data` |
| `JWT_SECRET` | JWT 签名密钥（需随机生成） | — |
| `ADMIN_TOKEN` | 管理接口令牌 | — |
| `ENCRYPTION_KEY_HEX` | AES-256-GCM 主密钥（64 位十六进制） | — |

### 生成配对码（首次配对）

```bash
curl -X POST https://bridge.example.com/admin/pair-codes \
  -H "x-admin-token: <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"ttl_secs": 600}'
# → {"code": "ABCD1234", "ttl_secs": 600}
```

在桌面 EchoMind → Cloud Bridge 页面填入服务器地址和配对码完成绑定。

---

## 隐私说明

EchoMind 采用"本地优先"架构：

- **所有想法默认存在本地**，不上传任何服务器
- **Cloud Bridge 是明确的付费可选扩展**：开启即代表用户知情同意，选定子集内的想法会存储在你的 VPS 上
- **LLM API Key 可选推送**到 VPS，用于 `/chat` 远程执行；VPS 用 AES-256-GCM 加密存储，管理员有物理访问能力
- 随时终止订阅，VPS 数据立即销毁

详见 [`docs/architecture-hybrid-cloud.md`](docs/architecture-hybrid-cloud.md)。

## License

MIT
