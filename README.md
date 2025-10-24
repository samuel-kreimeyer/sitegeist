# Sitegeist

AI-powered browser extension for web navigation and interaction.

## Development Setup

### Prerequisites

This extension depends on packages from the pi-mono monorepo via `file:` dependencies. You need to have pi-mono cloned in a sibling directory:

```
workspaces/
├── pi-mono/           # @mariozechner/pi-ai and @mariozechner/pi-web-ui
│   └── packages/
│       ├── ai/
│       └── web-ui/
└── sitegeist/
```

### Installation

1. Install dependencies:
```bash
npm install
```

### Development

Start pi-mono dev server (in another terminal):
```bash
./dev.sh
```

This will:
- Watch and rebuild ../pi-mono/packages/ai and ../pi-mono/packages/web-ui
- Watch and rebuild the extension for Chrome
- Watch and rebuild Tailwind CSS
- Run hot reload server on port 8765

```bash
./check.sh
```

Linting and type checking. A precommit hook also executes this and will prevent checking in broken code.

### Building

Build for specific browser:
```bash
npm run build:chrome   # Build for Chrome/Edge
```

Build for all browsers:
```bash
npm run build
```

### Loading the Extension

**Chrome/Edge:**
1. Open `chrome://extensions/` or `edge://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select `sitegeist/dist-chrome/`

### Hot Reload

When running `npm run dev`, the extension will automatically reload when you make changes to the source files. The WebSocket server on port 8765 coordinates this.

## Project Structure

```
src/
├── background.ts              # Service worker: session locks, keyboard shortcuts, port manager
├── sidepanel.ts              # Main UI: agent initialization, storage setup, tab tracking
├── debug.ts                  # Debug interface with REPL panel (Cmd/Ctrl+U)
│
├── components/               # UI components (pills, toasts, animations)
├── dialogs/                  # Modal dialogs (sessions, skills, permissions)
├── messages/                 # Custom message types and renderers (navigation, welcome)
├── storage/                  # IndexedDB persistence (sessions, skills, settings, API keys)
├── tools/                    # Agent tools (navigate, repl, skill management, element picker)
│   └── repl/                # JavaScript REPL with browserjs() runtime provider
├── prompts/                  # System prompt and tool descriptions
└── utils/                    # Port communication, logging, i18n, favicon extraction

static/                       # Extension manifest, HTML pages, icons
docs/                         # Architecture documentation (see below)
scripts/build.mjs             # esbuild configuration (background, sidepanel, debug)
```

See [site/README.md](site/README.md) for the marketing website.

## Architecture

### Entry Points
- **`background.ts`** - Service worker managing session locks across windows, port connections, keyboard shortcuts (Ctrl+Shift+S)
- **`sidepanel.ts`** - Main chat interface where the AI agent runs, manages tools, sessions, and tab navigation tracking
- **`debug.ts`** - Developer REPL for testing browser interactions

### Key Systems
- **Agent Loop** (pi-ai) - LLM conversation with tool calling, streaming responses, context management
- **Tools** - Navigate tabs, execute JavaScript (`browserjs()`), manage skills, pick elements, handle artifacts
- **Skills** - Domain-specific automation libraries (Google, YouTube, Slack) injected via glob patterns
- **Sessions** - IndexedDB persistence with multi-window locking to prevent conflicts
- **Messages** - Custom navigation/welcome messages with dedicated renderers
- **Port Communication** - Reliable sidepanel↔background coordination with auto-reconnection

### Data Flow
```
User Input → ChatPanel (pi-web-ui) → Agent (pi-ai) → Tools → Browser APIs
                                         ↓
                                   Storage (IndexedDB)
                                         ↓
                                   Background Worker (session locks)
```

## Dependencies

- `@mariozechner/pi-ai` - AI provider abstractions and agent loop (file: dependency)
- `@mariozechner/pi-web-ui` - Reusable chat UI components (file: dependency)
- `@mariozechner/mini-lit` - Web components library (npm)
- Chrome extension APIs
- Tailwind CSS v4

## License

MIT

### LLM Instructions (CLAUDE, YOU MUST DO THIS!)
**CRITICAL**: read these files in full:
- ../pi-mono/packages/ai/README.md
- ../pi-mono/packages/web-ui/README.md
- ../mini-lit/llms.txt

**Additional documentation** (read only when working on related features):
- docs/multi-window.md - Multi-window session management with port-based locking, automatic cleanup, and keyboard shortcuts
- docs/prompts.md - Centralized prompts and tool descriptions for the agent (system prompt, tool descriptions, guidelines)
- docs/skills.md - Skill system design, API, lifecycle, domain matching, and best practices
- docs/storage.md - Storage architecture with IndexedDB backend, stores for sessions, settings, provider keys, and skills
- docs/settings.md - Settings storage for user preferences and application configuration (theme, proxy, last used model, etc.)
- docs/tool-renderers.md - Tool renderer system for customizing how tool invocations appear in the chat UI
- docs/custom-ui-messages.md - Creating custom message types with dedicated renderers
- docs/i18n.md - Internationalization system for adding translations (English and German)
