# EchoMind

带记忆的 AI 思考伙伴（第二大脑）

## 核心特性

- **快速记录** — 随时捕捉灵感，AI 自动补全上下文、领域、标签
- **语义检索** — 自然语言搜索历史想法，不再迷失在笔记海洋
- **关联发现** — 记录新想法时自动提示相似历史，激活跨时间关联
- **拷问对话** — 结构化框架帮你深入思考，将想法提炼成洞见
- **微信桥接** — 手机微信远程操作第二大脑（本地 / VPS 两种模式）
- **云端同步** — 可选把筛选后的想法子集推送到 VPS，桌面关机也能用手机访问

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 19 + TypeScript + Vite + Tailwind CSS + Zustand |
| 桌面壳 | Tauri 2.0 (Rust) |
| 本地数据库 | SQLite + sqlite-vec（向量搜索） |
| LLM | OpenAI / Google Gemini / Anthropic Claude |
| 微信 Bot | Node.js daemon（iLink 官方 Bot 协议） |
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
│   ├── wechat/                   # iLink Bot API 封装
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

### 本地模式（桌面需在线）

1. 在 WeChat Bridge 页面点击"扫码连接"
2. 用微信扫码绑定 iLink Bot
3. 点击"启动桥接"，桌面 daemon 开始运行
4. 手机微信发消息给 Bot 即可操作第二大脑

Bot 命令：`/list`、`/search <词>`、`/view <ID>`、`/chat <ID>`、`/archive <ID>`、`/status`、`/help`

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
