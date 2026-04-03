# EchoMind

带记忆的 AI 思考伙伴（第二大脑）

## 核心特性

- **快速记录** - 随时捕捉灵感，AI 自动补全上下文、领域、标签
- **语义检索** - 用自然语言搜索历史想法，不再迷失在笔记海洋
- **关联发现** - 记录新想法时，自动提示相似历史，激活跨时间关联
- **拷问对话** - 结构化框架帮你深入思考，将想法提炼成洞见

## 技术栈

- **前端**: React 19 + TypeScript + Vite + Tailwind CSS + Zustand
- **后端**: Tauri 2.0 (Rust)
- **数据库**: SQLite + sqlite-vec (向量搜索)
- **LLM**: OpenAI / Google Gemini / Anthropic Claude

## 开始使用

### 前置要求

- Node.js 18+
- Rust 1.70+
- pnpm

### 安装依赖

```bash
pnpm install
```

### 配置 API Key

首次使用需要在设置页面配置 LLM API Key（支持 OpenAI / Gemini / Claude）

### 开发

```bash
pnpm tauri dev
```

### 构建

```bash
pnpm tauri build
```

## 项目结构

```
src/                      # React 前端
├── components/           # UI 组件
├── pages/               # 页面
├── stores/              # Zustand 状态管理
└── lib/                 # 类型定义

src-tauri/               # Tauri Rust 后端
├── src/
│   ├── commands/        # Tauri 命令
│   ├── db/              # 数据库操作
│   └── llm/             # LLM 接口
└── sqlite-vec/          # 向量搜索扩展
```

## License

MIT
