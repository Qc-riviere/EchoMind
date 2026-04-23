# EchoMind UI Redesign Plan

## Design System: "Cognitive Sanctuary"

Dark obsidian editorial aesthetic. Surfaces define depth, not borders. Typography is the hierarchy.

---

## Phase 1: Foundation (Global)

### 1.1 Tailwind Config
- Replace entire color palette with obsidian tokens
- Add Manrope + Inter font families
- Adjust border-radius defaults

### 1.2 Icon Migration
- Replace Lucide React → Material Symbols Outlined (300 weight, no fill)
- Install `material-symbols` package or use Google Fonts CDN link

### 1.3 MainLayout Restructure
- **Current:** Top nav + centered content
- **Target:** Fixed sidebar (w-64) + sticky top bar + scrollable main area
- Sidebar: Logo, nav links (Home/Search/Archive/Chat/WeChat/Settings), "New Inspiration" CTA at bottom
- TopAppBar: Breadcrumb left, search + notifications right, `bg-surface/60 backdrop-blur-xl`

### 1.4 Global Styles
- `body`: bg-[#131313], text-[#e5e2e1], font-family Inter
- No 1px solid borders anywhere — use background color shifts
- Ghost borders only: `border border-[#424656]/15`
- Scrollbar: 4px width, #353534 thumb, transparent track

---

## Phase 2: Core Pages

### 2.1 HomePage
- **ThoughtInput:** Large textarea (min-h-[120px]), bg-surface-container-low, no border. Bottom toolbar with image/file/voice buttons left, gradient "Save" CTA right
- **ThoughtCard:** Dark card (bg-[#0e0e0e]), optional left image (1/3 width, grayscale → color on hover). Tags: uppercase, tracking-wider, bg-[#353534], text-primary. AI Insight: left blue border accent
- **Right Discovery Panel:** 4-col grid on lg, show "Cognitive Discovery" with match percentages + progress bars
- **ThoughtDrawer:** Dark slide-out, bg-surface-container-low

### 2.2 SearchPage
- **Search Bar:** Full-width, text-2xl, bg-surface-container-low, neurology icon left, ⌘K badge right
- **Results:** Bento grid (12-col). Hero result 8-col with image, secondary results 4-col. Vector match percentage badges
- **AI Memory Fragment:** Wide card showing related chat context

---

## Phase 3: Secondary Pages

### 3.1 ChatPage (Deep Questioning)
- **Messages:** User = right-aligned, bg-surface-container-high, rounded-tr-none. AI = left-aligned, thought-stream gradient bg, wider max-width
- **Input:** Floating glass panel at bottom (backdrop-blur-32px, bg-surface-variant/60). Quick action chips below: "Market Demand", "Competitive Analysis", "Persona Deep Dive", "Risk Mitigation"
- **Right Panel:** Contextual inspirations with image cards

### 3.2 ArchivePage
- **Header:** "The Attic of Thought", large title + filter tabs (All/Week/Month)
- **Cards:** Horizontal layout — image left (w-48), content center, Restore/Delete buttons right
- **Footer:** 30-day retention notice + "Empty Archive" button

### 3.3 SettingsPage
- **Sections:** Numbered (01 LLM Config, 02 Embedding Config), separated by border-b
- **Inputs:** bg-surface-container-low, no border, focus:ring-primary/20
- **Model Selection:** List with check icon for active model
- **Embedding:** Toggle for "Reuse LLM Key", range slider for dimensions
- **Danger Zone:** Gradient red border wrapper, "Purge Environment" button

### 3.4 WeChatBridgePage
- **Header:** Large title "WeChat Bridge" + description
- **Bento Grid:** QR code card (4-col) + 3 status cards (8-col: Server/Account/Bridge)
- **Command Panel:** 2-col grid of command cards with monospace command labels
- **Footer:** Last handshake time + data transferred + Revoke/Regenerate buttons

---

## Color Token Reference

| Token | Hex | Usage |
|-------|-----|-------|
| surface | #131313 | Base background |
| surface-container-low | #1c1b1b | Secondary panels |
| surface-container | #201f1f | Mid-level containers |
| surface-container-high | #2a2a2a | Interactive cards |
| surface-container-highest | #353534 | Elevated elements |
| surface-container-lowest | #0e0e0e | Recessed cards |
| primary | #adc7ff | Accent, links, active states |
| primary-container | #006ee5 | Gradient end, CTA fills |
| on-surface | #e5e2e1 | Primary text |
| on-surface-variant | #c2c6d8 | Secondary text |
| on-primary | #002e68 | Text on primary bg |
| outline | #8c90a1 | Subtle icons |
| outline-variant | #424656 | Ghost borders (at 15%) |
| error | #ffb4ab | Soft coral error |
| secondary | #adcbda | Secondary accent |
| tertiary | #b6cad2 | Tertiary accent |

## Typography

| Role | Font | Weight | Size | Tracking |
|------|------|--------|------|----------|
| Display | Manrope | 800 | 3.5rem | tight |
| Headline | Manrope | 700 | 2rem | tight |
| Title | Manrope | 600 | 1.25rem | widest |
| Body | Inter | 400 | 0.875rem | normal |
| Label | Inter | 600 | 0.75rem | widest, uppercase |
| Mono/Meta | Mono | 400 | 0.625rem | widest |

## Key Rules
1. **No 1px borders** for layout — use bg color shifts
2. **No standard shadows** — use surface layering
3. **Ghost borders** only for inputs/interactive: `border-[#424656]/15`
4. **Tags/Labels:** Always uppercase, tracking-widest, 10px
5. **Dead space:** 32px+ padding is intentional luxury
6. **Icons:** Material Symbols, 300 weight, no fill, secondary color
