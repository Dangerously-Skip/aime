<p align="center">
  <h1 align="center">Open Claude Cowork</h1>
</p>
<p align="center">
<a href="[https://platform.composio.dev?utm_source=github&utm_medium=banner&utm_campaign=2101&utm_content=open-claude-cowork](https://platform.composio.dev/?utm_source=github&utm_medium=banner&utm_campaign=2101&utm_content=open-claude-cowork)">
<img src="assets/open%20claude%20cowork%20wide%20new.png" alt="Open Claude Cowork Banner" width="800">
</a>
</p>
<p align="center">
  <a href="https://platform.composio.dev?utm_source=github&utm_medium=gif&utm_campaign=2101&utm_content=open-claude-cowork">
    <img src="open-claude-cowork.gif" alt="Open Claude Cowork Demo" width="800">
  </a>
</p>

<p align="center">
  <a href="https://docs.composio.dev/tool-router/overview">
    <img src="https://img.shields.io/badge/Composio-Tool%20Router-orange" alt="Composio">
  </a>
  <a href="https://platform.claude.com/docs/en/agent-sdk/overview">
    <img src="https://img.shields.io/badge/Claude-Agent%20SDK-blue" alt="Claude Agent SDK">
  </a>
  <a href="https://github.com/anthropics/claude-code">
    <img src="https://img.shields.io/badge/Powered%20by-Claude%20Code-purple" alt="Claude Code">
  </a>
  <a href="https://twitter.com/composio">
    <img src="https://img.shields.io/twitter/follow/composio?style=social" alt="Twitter">
  </a>
</p>

<p align="center">
  An open-source desktop chat application powered by Claude Agent SDK and Composio Tool Router. Automate your work end-to-end across desktop and all your work apps in one place.
  <br><br>
  <a href="https://platform.composio.dev?utm_source=github&utm_medium=description&utm_campaign=2101&utm_content=open-claude-cowork">
    <b>Get your free API key to get started →</b>
  </a>
</p>

## Features

- **Multi-Provider Support** - Choose between Claude Agent SDK and Opencode for different model options
- **Claude Agent SDK Integration** - Full agentic capabilities with tool use and multi-turn conversations
- **Opencode SDK Support** - Access multiple LLM providers (Claude, GPT-5, Grok, GLM, MiniMax, and more)
- **Composio Tool Router** - Access to 500+ external tools (Gmail, Slack, GitHub, Google Drive, and more)
- **Persistent Chat Sessions** - Conversations maintain context across messages using SDK session management
- **Multi-Chat Support** - Create and switch between multiple chat sessions
- **Real-time Streaming** - Server-Sent Events (SSE) for smooth, token-by-token response streaming
- **Tool Call Visualization** - See tool inputs and outputs in real-time in the sidebar
- **Progress Tracking** - Todo list integration for tracking agent task progress
- **Skills Support** - Extend Claude with specialized capabilities using custom skills
- **Modern UI** - Clean, dark-themed interface inspired by Claude.ai
- **Desktop App** - Native Electron application for macOS, Windows, and Linux

---

## Tech Stack

| Category | Technology |
|----------|------------|
| **Desktop Framework** | Electron.js |
| **Backend** | Node.js + Express |
| **AI Providers** | Claude Agent SDK + Opencode SDK |
| **Tool Integration** | Composio Tool Router + MCP |
| **Streaming** | Server-Sent Events (SSE) |
| **Markdown** | Marked.js |
| **Styling** | Vanilla CSS |

---

## Getting Started

### Quick Setup (Recommended)

```bash
# Clone the repository
git clone https://github.com/ComposioHQ/open-claude-cowork.git
cd open-claude-cowork

# Run the automated setup script
./setup.sh
```

The setup script will:
- Install Composio CLI if not already installed
- Guide you through Composio signup/login
- Configure your API keys in `.env`
- Install all project dependencies

### Manual Setup

If you prefer manual setup, follow these steps:

#### Prerequisites

- Node.js 18+ installed
- **For Claude Provider:**
  - Anthropic API key ([console.anthropic.com](https://console.anthropic.com))
- **For Opencode Provider:**
  - Opencode API key ([opencode.dev](https://opencode.dev))
- Composio API key ([app.composio.dev](https://app.composio.dev))

#### 1. Clone the Repository

```bash
git clone https://github.com/ComposioHQ/open-claude-cowork.git
cd open-claude-cowork
```

#### 2. Install Dependencies

```bash
# Install Electron app dependencies
npm install

# Install backend dependencies
cd server
npm install
cd ..
```

#### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your API keys:

```env
# Claude Provider
ANTHROPIC_API_KEY=your-anthropic-api-key

# Opencode Provider (optional)
OPENCODE_API_KEY=your-opencode-api-key
OPENCODE_HOSTNAME=127.0.0.1
OPENCODE_PORT=4096

# Composio Integration
COMPOSIO_API_KEY=your-composio-api-key
```

**Provider Selection:**
- The app allows switching between **Claude** and **Opencode** providers in the UI
- Only configure the API key(s) for the provider(s) you want to use
- Opencode can route to multiple model providers through a single SDK

### Starting the Application

You need **two terminal windows**:

**Terminal 1 - Backend Server:**
```bash
cd server
npm start
```

**Terminal 2 - Electron App:**
```bash
npm start
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Electron App                              │
│  ┌─────────────────┐    ┌─────────────────┐                     │
│  │   Main Process  │    │ Renderer Process │                    │
│  │   (main.js)     │    │  (renderer.js)   │                    │
│  └────────┬────────┘    └────────┬─────────┘                    │
│           │                      │                               │
│           └──────────┬───────────┘                               │
│                      │ IPC (preload.js)                          │
└──────────────────────┼───────────────────────────────────────────┘
                       │
                       │ HTTP + SSE
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Backend Server                               │
│  ┌─────────────────┐    ┌─────────────────┐                     │
│  │  Express.js     │───▶│ Claude Agent SDK │                    │
│  │  (server.js)    │    │  + Session Mgmt  │                    │
│  └─────────────────┘    └────────┬─────────┘                    │
│                                  │                               │
│                                  ▼                               │
│                    ┌─────────────────────────┐                   │
│                    │   Composio Tool Router  │                   │
│                    │   (MCP Server)          │                   │
│                    └─────────────────────────┘                   │
└─────────────────────────────────────────────────────────────────┘
```

### Session Management

The app uses Claude Agent SDK's built-in session management:
1. First message creates a new session, returning a `session_id`
2. Subsequent messages use `resume` option with the stored session ID
3. Full conversation context is maintained server-side

### Tool Integration

Composio Tool Router provides MCP server integration:
- Tools are authenticated per-user via Composio dashboard
- Available tools include Google Workspace, Slack, GitHub, and 500+ more
- Tool calls are streamed and displayed in real-time

### Provider Architecture

The application supports multiple AI providers through a pluggable provider system:

#### Claude Provider
- Uses Anthropic's Claude Agent SDK
- Available models:
  - Claude Opus 4.5 (claude-opus-4-5-20250514)
  - Claude Sonnet 4.5 (claude-sonnet-4-5-20250514) - default
  - Claude Haiku 4.5 (claude-haiku-4-5-20250514)
- Session management via built-in SDK session tracking
- Direct streaming from Claude API

#### Opencode Provider
- Routes to multiple LLM providers through a single SDK
- Available models:
  - `opencode/big-pickle` - Free reasoning model (default)
  - `opencode/gpt-5-nano` - OpenAI's reasoning models
  - `opencode/glm-4.7-free` - Zhipu GLM models
  - `opencode/grok-code` - xAI Grok for coding
  - `opencode/minimax-m2.1-free` - MiniMax models
  - `anthropic/*` - Claude models through Opencode
- Event-based streaming with real-time part updates
- Session management per chat conversation
- Extended thinking support (reasoning parts)

**Streaming Implementation:**
Both providers use Server-Sent Events (SSE) for streaming responses:
- Backend: Express server streams normalized chunks via HTTP
- Frontend: Real-time processing with markdown rendering
- Tool calls: Inline display with input/output visualization

### Skills System

The application supports **Agent Skills** - specialized capabilities that Claude automatically invokes when relevant.

#### What are Skills?

Skills extend Claude with domain-specific knowledge and capabilities. They are defined as markdown files with instructions that Claude follows when the skill is triggered.

#### How Skills Work

1. **Filesystem-based**: Skills are stored as `SKILL.md` files in `.claude/skills/`
2. **Auto-discovered**: Skills are loaded from user and project directories at startup
3. **Model-invoked**: Claude autonomously chooses when to use them based on the skill description
4. **Context-aware**: Skills receive full conversation context when triggered

#### Included Skills

**Remotion Best Practices** (`.claude/skills/remotion-best-practices/`)
- Triggered when: User asks about creating videos with React, Remotion framework, or programmatic video generation
- Provides: Best practices for Remotion, animation patterns, Player optimization, troubleshooting guides

#### Creating Custom Skills

1. **Create a skill directory:**
```bash
mkdir -p .claude/skills/my-skill
```

2. **Create SKILL.md with YAML frontmatter:**
```markdown
---
description: Use this skill when the user asks about [your topic]
---

# My Skill Name

Instructions for Claude when this skill is invoked...

## When to Use
- User asks about X
- User needs help with Y
```

3. **Test the skill:**
Ask Claude a question that matches your skill's description. Claude will automatically invoke it.

#### Skill Locations

- **Project Skills** (`.claude/skills/`) - Shared with your team via git
- **User Skills** (`~/.claude/skills/`) - Personal skills across all projects

#### Configuration

Skills are enabled in the Claude provider with:
```javascript
settingSources: ['user', 'project']  // Loads skills from both locations
allowedTools: [..., 'Skill']          // Enables the Skill tool
```

For more details on creating effective skills, see the [Agent Skills documentation](https://platform.claude.com/docs/en/agent-sdk/skills).

---

### MCP Configuration (Tools Integration)

**Important: Opencode requires MCP servers to be configured in `server/opencode.json`**

The application automatically updates this file when starting:
1. Composio session is created on first request with MCP URL
2. Backend writes the MCP config to `server/opencode.json`
3. Opencode reads the config file and loads MCP tools

**File: `server/opencode.json`**
```json
{
  "mcp": {
    "composio": {
      "type": "remote",
      "url": "https://backend.composio.dev/tool_router/YOUR_ROUTER_ID/mcp",
      "headers": {
        "x-api-key": "YOUR_API_KEY"
      }
    }
  }
}
```

**Note:** Don't manually edit this file - it's generated automatically by the backend. The placeholders are replaced with real credentials from your Composio session.

---

## File Structure

```
open-claude-cowork/
├── .claude/
│   └── skills/             # Agent Skills directory
│       └── remotion-best-practices/
│           └── SKILL.md    # Remotion skill definition
├── main.js                 # Electron main process
├── preload.js              # IPC security bridge
├── renderer/
│   ├── index.html          # Chat interface
│   ├── renderer.js         # Frontend logic & streaming handler
│   └── style.css           # Styling
├── server/
│   ├── server.js           # Express + Provider routing + MCP config writer
│   ├── opencode.json       # MCP config (auto-generated, see note below)
│   ├── providers/
│   │   ├── base-provider.js      # Abstract base class
│   │   ├── claude-provider.js    # Claude Agent SDK implementation
│   │   └── opencode-provider.js  # Opencode SDK implementation
│   └── package.json
├── package.json
├── .env                    # API keys (not tracked)
└── .env.example            # Template
```

**Note on `server/opencode.json`:**
- Generated automatically by the backend when you run the app
- Contains Composio MCP URL and credentials
- Opencode reads this file to load tools
- Don't track in git (add to `.gitignore` or use template)

---

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start the Electron app |
| `npm run dev` | Start in development mode with live reload |
| `cd server && npm start` | Start the backend server |

---

## Troubleshooting

**"Failed to connect to backend"**
- Ensure backend server is running on port 3001
- Check Terminal 1 for error logs
- Verify firewall isn't blocking localhost:3001

**"API key error"**
- For Claude: Verify `ANTHROPIC_API_KEY` in `.env` starts with `sk-ant-`
- For Opencode: Ensure `OPENCODE_API_KEY` is valid and from opencode.dev
- Ensure `COMPOSIO_API_KEY` is valid

**"Provider not available"**
- Ensure the required API key is configured in `.env`
- Restart the backend server after changing `.env`
- Check server logs for initialization errors

**"Session not persisting"**
- Check server logs for session ID capture
- Ensure `chatId` is being passed from frontend
- Different providers use different session mechanisms (Claude SDK vs Opencode sessions)

**"Streaming seems slow or incomplete"**
- Check network/firewall settings for SSE connections
- Verify backend is receiving events from provider SDK
- Check browser console for connection errors
- For Opencode: Ensure event subscription is receiving `message.part.updated` events

**"Opencode models not responding"**
- Verify Opencode server is running (localhost:4096 or configured URL)
- Check that model identifiers match Opencode format (e.g., `opencode/big-pickle`)
- Review Opencode API documentation for available models
- Check server logs for Opencode SDK initialization errors

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## Resources

### AI & Agent SDKs
- [Claude Agent SDK Documentation](https://docs.anthropic.com/en/docs/claude-agent-sdk)
- [Agent Skills Documentation](https://platform.claude.com/docs/en/agent-sdk/skills)
- [Opencode SDK Documentation](https://docs.opencode.dev)

### Tools & Integration
- [Composio Tool Router](https://docs.composio.dev/tool-router)
- [Composio Dashboard](https://app.composio.dev)

### Frameworks
- [Electron Documentation](https://www.electronjs.org/docs)
- [Opencode Platform](https://opencode.dev)
- [Remotion Documentation](https://www.remotion.dev/docs/)

---


## Join the Community

- [Join our Discord](https://discord.com/invite/composio) - Chat with other developers building Claude Skills
- [Follow on Twitter/X](https://x.com/composio) - Stay updated on new skills and features
- Questions? [support@composio.dev](mailto:support@composio.dev)

---


<p align="center">
  <b>Join 200,000+ developers building agents in production</b>
</p>

<p align="center">
  <a href="https://platform.composio.dev/?utm_source=github&utm_medium=community&utm_campaign=2101&utm_content=open claude cowork">
    <img src="https://img.shields.io/badge/Get_Started_For_Free-4F46E5?style=for-the-badge" alt="Get Started For Free"/>
  </a>
</p>



<p align="center">
  Built with Claude Code and Composio
</p>
