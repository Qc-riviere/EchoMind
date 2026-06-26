# EchoMind

> 🌐 [中文](./README.md) · **English**

Inspiration notes · cross-device capture + AI auto-curation + occasional deep dives.

## Core features

### Capture
- **30-second onboarding** — a four-step wizard on first launch: pick a provider → paste a key and test the connection → record your first note → preview the WeChat bridge
- **Global capture popup** — `Ctrl+Shift+I` summons a borderless overlay from any app. `Enter` saves, `Esc` / focus loss hides. The window stays resident so the hotkey responds instantly
- **Tray-resident** — the system tray icon hovers a "+N new today" badge; click to focus the main window
- **WeChat capture** — send a message to the bot from your phone's WeChat and it lands in the database; the desktop syncs and surfaces a system notification within ~5 seconds
- **AI auto-enrich** — context, domain and tags are generated automatically, no manual curation

### Browse
- **Two-column home** — "Recent 5" + "Most chatted 5" cover the time axis and the attention axis separately
- **Pin what matters most** — up to 5 notes can be pinned to the top of home (drag to reorder) to represent your current "main thread"
- **Semantic search** — natural-language search over your full note history
- **Related discovery** — when a new note lands, similar past notes are surfaced

### Curate
- **Multi-select AI summary** — tick 2-20 notes and let the AI distill them into a central thesis with bullet points. Save back as a new note or export to MD / DOCX / PDF
- **Conversational deep-dive** — open a chat on any single note; a structured framework guides the interrogation. Resume any past session from home or the sidebar
- **Synthesize chat → plan document** — the "Synthesize Plan" button on the chat page distills the entire conversation into a deliverable plan (core conclusions / key decisions / risks & open questions / next actions), exportable to MD / DOCX / PDF or saved as a new note

### Multi-device
- **WeChat bridge** — operate your second brain remotely from your phone's WeChat (local or VPS mode)
- **Cloud sync** — optionally push a filtered subset of notes to a VPS so you can keep using your phone even when the desktop is off

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | React 19 + TypeScript + Vite + Tailwind CSS + Zustand |
| Desktop shell | Tauri 2.0 (Rust) |
| Local database | SQLite + sqlite-vec (vector search) |
| LLMs | OpenAI / Google Gemini / Anthropic Claude |
| WeChat bot | TypeScript / Node API → `bun build --compile` to a single `.exe`, shipped as a Tauri sidecar inside the installer (built on Tencent's official `@tencent-weixin/openclaw-weixin`, iLink protocol) |
| Cloud bridge | Rust + axum + rusqlite (`echomind-bridge-server`) |
| Token encryption | AES-256-GCM + OS keychain (Windows Credential Manager / macOS Keychain); account tokens are encrypted before they ever touch disk |

## Project layout

```
src/                              # React frontend
├── components/                   # UI components
├── pages/                        # Pages (Home / Chat / Archive / Search / Settings
│                                 #        CloudBridge / WeChatBridge / ...)
├── stores/                       # Zustand state
└── lib/                          # Type definitions

src-tauri/                        # Tauri Rust backend
├── src/
│   ├── commands/                 # Tauri commands (thought / ai / chat / bridge)
│   └── lib.rs                    # App entry + invoke_handler registration
├── echomind-core/                # Independently testable core library
│   ├── src/
│   │   ├── bridge/               # Cloud Bridge client + rules engine
│   │   ├── db/                   # Local SQLite (thoughts / chats / vectors / settings)
│   │   ├── llm/                  # LLM provider abstraction (OpenAI / Gemini / Claude)
│   │   └── lib.rs                # EchoMindCore high-level API
│   └── Cargo.toml
└── echomind-bridge-server/       # VPS bridge service (standalone binary)
    ├── src/
    │   ├── auth.rs               # JWT issue + verify
    │   ├── crypto.rs             # AES-256-GCM encrypt / decrypt
    │   ├── db.rs                 # Per-device SQLite (subset + vectors)
    │   ├── llm.rs                # Remote LLM forwarding (OpenAI / Claude / Gemini)
    │   ├── pairing.rs            # Pair codes + device management + budget tracking
    │   ├── routes.rs             # axum routes
    │   └── state.rs              # Shared state
    └── Cargo.toml

echomind-wechat/                  # WeChat bot daemon (Node.js)
├── src/
│   ├── commands/router.ts        # Command router (local mode + bridge standalone)
│   ├── echomind/
│   │   ├── client.ts             # Local EchoMind server HTTP client
│   │   └── bridge-client.ts     # VPS bridge server HTTP client
│   ├── wechat/                   # WeChat ClawBot wrapper (Tencent's iLink protocol)
│   └── session.ts                # Per-user session management
└── package.json
```

## Quick start

### Prerequisites

- Node.js 18+
- Rust 1.70+
- pnpm
- [bun](https://bun.sh) (for compiling the WeChat bot sidecar; install once before your first `pnpm tauri build`)

### Local development

```bash
pnpm install
pnpm tauri dev
```

### Build

```bash
pnpm tauri build
```

The `beforeBuildCommand` in `pnpm tauri build` automatically runs `scripts/build-sidecars.mjs`:
1. `cargo build -p echomind-server --release [--target <triple>]` → `binaries/echomind-server-<triple>[.exe]`
2. If `echomind-wechat/node_modules` is missing, run `npm ci` automatically
3. `bun build --compile --target=<bun-target> src/main.ts` → `binaries/echomind-wechat-bot-<triple>[.exe]`

Both sidecars enter the bundle through `bundle.externalBin` in `tauri.conf.json`, end up next to the main `.exe` after install, and Tauri strips the triple suffix automatically. The script is idempotent — up-to-date artifacts are skipped, so dev mode doesn't recompile on every launch.

The four-step onboarding wizard pops up on first launch (welcome → pick provider, paste key, test → record your first note → optional WeChat bridge). The whole thing takes ~30 seconds. Everything is changeable later in Settings. Supports OpenAI / Claude / Gemini / DeepSeek (DeepSeek recommended for users in mainland China — easy top-up).

---

## WeChat bridge (optional)

> EchoMind connects via the **personal-account Bot API that Tencent officially opened in 2026** — product name **WeChat ClawBot**, underlying protocol **iLink**, npm package [`@tencent-weixin/openclaw-weixin`](https://www.npmjs.com/package/@tencent-weixin/openclaw-weixin) (official Tencent scope).
>
> **No ban risk, no commercial restrictions.** The bot joins your WeChat as a separate contact; your primary account is untouched. This is fundamentally different from wechaty / PadWechat-style third-party protocols that have been blocked.
>
> References: [GitHub Tencent/openclaw-weixin](https://github.com/Tencent/openclaw-weixin) · [OpenClaw docs — WeChat Channel](https://docs.openclaw.ai/channels/wechat)

### Local mode (requires the desktop to be online)

1. Click "Scan to connect" on the WeChat Bridge page
2. The desktop spawns two sidecars: `echomind-server` (local HTTP API) + `echomind-wechat-bot` (bun-compiled single exe)
3. The QR code renders directly inside the page — scan it with your own WeChat to authorize
4. The `bot_token` is encrypted with AES-256-GCM before being written to `~/.echomind-wechat/accounts/*.enc` (key kept in the OS keychain)
5. Send messages from your phone's WeChat to the bot to operate your second brain

Starting with v0.3.2, sidecars are fully bundled into the installer — new users **don't need to install Node.js or run npm install** separately. Works out of the box.

Bot commands: `/list`, `/search <term>`, `/view <ID>`, `/chat <ID>`, `/archive <ID>`, `/status`, `/help`

`/chat` replies append a latency footer (`⏱ 1.8s`) so you can gauge model response speed. Plain text (no leading slash) creates a new note; the desktop pulls it within ~5 seconds and fires a system notification.

### Cloud mode (VPS runs independently, the desktop can be offline)

Requires you to provision a VPS and deploy `echomind-bridge-server` — see [VPS deployment](#vps-deployment).

After pairing, push your subset of notes and (optionally) your LLM configuration from the Cloud Bridge page; the `echomind-wechat` daemon on the VPS runs standalone using `ECHOMIND_BRIDGE_URL` + `ECHOMIND_BRIDGE_TOKEN` env vars.

---

## VPS deployment

### Using Docker Compose (recommended)

```bash
git clone <this-repo>
cd echomind-bridge-server

# Generate secrets
echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env
echo "ADMIN_TOKEN=$(openssl rand -hex 16)" >> .env
echo "ENCRYPTION_KEY_HEX=$(openssl rand -hex 32)" >> .env

docker compose up -d
```

See `docker-compose.yml` and the nginx config in the [`deploy/`](deploy/) directory.

### Configuration

| Env var | Purpose | Default |
|---|---|---|
| `BIND_ADDR` | Listen address | `0.0.0.0:3000` |
| `DATA_DIR` | Data directory | `./data` |
| `JWT_SECRET` | JWT signing secret (must be randomly generated) | — |
| `ADMIN_TOKEN` | Admin-API token | — |
| `ENCRYPTION_KEY_HEX` | AES-256-GCM master key (64 hex chars) | — |

### Issuing a pair code (first-time pairing)

```bash
curl -X POST https://bridge.example.com/admin/pair-codes \
  -H "x-admin-token: <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"ttl_secs": 600}'
# → {"code": "ABCD1234", "ttl_secs": 600}
```

Enter the server address and pair code on EchoMind → Cloud Bridge to finish binding.

---

## Privacy

EchoMind is local-first by design:

- **All notes live on your machine by default** — nothing is uploaded to any server
- **Cloud Bridge is an explicit, paid, optional add-on** — enabling it means you've consented to having the selected subset of notes stored on your VPS
- **Your LLM API key can optionally be pushed** to the VPS for `/chat` remote execution; it is stored AES-256-GCM-encrypted on the VPS, but the operator has physical access to the box
- Terminate the subscription at any time and the VPS data is destroyed immediately

Full details in [`docs/architecture-hybrid-cloud.md`](docs/architecture-hybrid-cloud.md).

## License

MIT
