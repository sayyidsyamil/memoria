# Memoria

## A Self-Learning Personal Knowledge Agent with Persistent Memory and Autonomous Knowledge Discovery

> An AI System That Captures, Connects, and Expands What You Know While You Sleep

---

## The Problem

The average knowledge worker attends **25.6 meetings per week** (Otter.ai, 2025 Meeting Statistics Report). The average university student sits through **15 to 20 hours of lectures weekly**. In both cases, information is delivered, discussed, and then largely forgotten.

Ebbinghaus (1885) demonstrated that without active reinforcement, people lose roughly **two-thirds of new information within a single day**.

But forgetting is not even the biggest problem.

The bigger problem is that the connections between what was said in Monday's meeting, what was taught in Wednesday's lecture, and what was read in Friday's article are **never made**. Those connections are where real insight lives, and they are lost because human memory cannot search across contexts.

Existing note-taking tools like Notion and Otter.ai treat each session as an island. They transcribe, they summarize, and they file. They do not **understand**, **connect**, or **grow**.

---

## What is Memoria?

Memoria is an AI-powered personal knowledge agent that:

1. **Listens** to meetings, lectures, and online content
2. **Generates** structured notes and extracts key facts and concepts
3. **Stores** everything into a persistent knowledge graph
4. **Connects** insights across different sessions and contexts
5. **Researches** autonomously while you sleep to fill knowledge gaps
6. **Surfaces** surprising relationships between ideas from completely different contexts

### While You Sleep

A background research agent reviews the day's knowledge:
- Identifies gaps and open questions
- Searches the internet for relevant information
- Enriches the knowledge graph with new connections and findings

You wake up to a **morning briefing** showing what Memoria learned overnight and what surprising connections it found across sessions.

### Over Time

Over weeks and months, Memoria builds a growing map of everything you've encountered, surfacing relationships between ideas that came from completely different contexts.

---

## Key Features

| Feature | Description |
|---------|-------------|
| **🎙️ Real-time Capture** | Listen to meetings, lectures, or audio streams and automatically generate structured notes |
| **🧠 Persistent Memory** | All knowledge is stored in a searchable, editable knowledge graph |
| **🔍 Cross-Context Search** | Find connections between ideas from different sessions |
| **🤖 Autonomous Research** | Background agent enriches your knowledge while you sleep |
| **📊 Morning Briefing** | Daily summary of new connections and insights discovered overnight |
| **✏️ Interactive Review** | Edit, approve, or discard AI-generated knowledge entries |
| **🔒 Privacy-First** | Your knowledge stays local; you control your data |

---

## Architecture

```
┌─────────────────┐      ┌──────────────────┐      ┌─────────────────┐
│   Frontend      │◄────►│     Backend      │◄────►│   AI Providers  │
│  (Next.js 16)   │      │  (FastAPI/Python)│      │(Anthropic/OpenAI│
│                 │      │                  │      │                 │
│ • React UI      │      │ • Agent Loop     │      │ • Streaming API │
│ • Terminal Feed │      │ • Tool Registry  │      │ • Multi-turn    │
│ • Knowledge     │      │ • Memory Store   │      │   Conversations │
│   Inspector     │      │ • Compaction     │      │                 │
└─────────────────┘      └──────────────────┘      └─────────────────┘
                                │
                                ▼
                       ┌──────────────────┐
                       │  Knowledge Graph │
                       │  (Persistent     │
                       │   Memory Store)  │
                       └──────────────────┘
```

### Tech Stack

| Component | Technology |
|-----------|------------|
| **Frontend** | Next.js 16, React 19, TypeScript, Tailwind CSS, shadcn/ui |
| **Backend** | Python 3.13, FastAPI, Uvicorn |
| **AI Providers** | Anthropic Claude, OpenAI GPT |
| **Package Manager** | pnpm |
| **Memory Storage** | Local file-based with markdown frontmatter |

---

## Quick Start

### Prerequisites

- Python 3.13+
- pnpm
- Anthropic API key or OpenAI API key

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/memoria.git
cd memoria

# Install Python dependencies
pnpm run install:py

# Install Node.js dependencies
pnpm install
```

### Configuration

Create a `.env` file in the `backend/` directory:

```env
# Required: API key for AI provider
ANTHROPIC_API_KEY=your_anthropic_api_key_here
# Or for OpenAI:
# OPENAI_API_KEY=your_openai_api_key_here

# Optional: Custom model selection
ANTHROPIC_MODEL=claude-sonnet-4-6
# OPENAI_MODEL=gpt-5.3-codex
```

### Run the Application

```bash
# Start both frontend and backend
pnpm run dev
```

The application will be available at:
- **Frontend**: http://localhost:3000
- **Backend API**: http://127.0.0.1:8000

---

## Usage

### 1. Chat with the Brain

Type a message in the terminal feed to start a conversation with Memoria Brain:

```
> Summarize my last meeting about Q3 investments
```

### 2. Review Generated Knowledge

When Memoria generates insights, click **"Review last reply"** to:
- Edit the title and summary
- Modify key points
- Add or remove tags
- Save to your knowledge graph

### 3. Search Your Knowledge

Use slash commands to interact:
```
/memory search investment strategies
/memory list
/help
```

### 4. Morning Briefing (Coming Soon)

Wake up to a daily summary of:
- New knowledge captured yesterday
- Connections found between sessions
- Research conducted by the background agent
- Recommended articles and resources

---

## Available Tools

Memoria Brain can use these tools to interact with your system:

| Tool | Description |
|------|-------------|
| `Read` | Read file contents with line numbers |
| `Write` | Write or create files |
| `Edit` | Replace exact text in files |
| `Bash` | Execute shell commands |
| `Glob` | Find files matching patterns |
| `Grep` | Search file contents with regex |
| `WebFetch` | Fetch and extract content from URLs |
| `WebSearch` | Search the web via DuckDuckGo |
| `MemorySave` | Save persistent memory entries |
| `MemorySearch` | Search your knowledge graph |
| `MemoryDelete` | Remove memory entries |
| `MemoryList` | List all stored memories |
| `Agent` | Spawn sub-agents for parallel tasks |

---

## Project Structure

```
memoria/
├── frontend/              # Next.js web application
│   ├── app/               # App router pages
│   │   ├── components/    # React components
│   │   │   ├── terminal-feed.tsx      # Main chat interface
│   │   │   └── knowledge-inspector.tsx # Knowledge review panel
│   │   ├── page.tsx       # Main application page
│   │   ├── layout.tsx     # Root layout
│   │   └── globals.css    # Global styles
│   ├── components/ui/     # shadcn/ui components
│   ├── lib/               # Utility functions
│   ├── public/            # Static assets
│   └── package.json       # Frontend dependencies
│
├── backend/               # Python FastAPI backend
│   ├── app/
│   │   └── main.py        # FastAPI entry point
│   ├── brain/
│   │   ├── chat.py        # HTTP chat + SSE streaming
│   │   └── repl.py        # Brain REPL commands
│   ├── memory/            # Memory management
│   │   ├── tools.py       # Memory tool implementations
│   │   ├── store.py       # Memory persistence
│   │   └── context.py     # Context relevance
│   ├── multi_agent/       # Sub-agent coordination
│   ├── skill/             # Skill system
│   ├── agent.py           # Core agent loop
│   ├── tools.py           # Built-in tool definitions
│   ├── providers.py       # AI provider integrations
│   ├── compaction.py      # Context window management
│   └── requirements.txt   # Python dependencies
│
├── package.json           # Root package.json
└── README.md              # This file
```

---

## Why Memoria?

### For Knowledge Workers

Investment analysts at organizations like **Khazanah Nasional Berhad** attend dozens of meetings weekly. Institutional knowledge directly impacts billion-ringgit decisions. Memoria ensures that:

- **No insight is lost**
- **No connection is missed**
- **Knowledge compounds over time**

### For Students

With 15-20 hours of lectures weekly, students struggle to:
- Retain information long-term
- Connect concepts across courses
- Find relevant past notes when needed

Memoria builds a **personal knowledge graph** that grows with every lecture, automatically connecting related concepts.

### For Researchers

Researchers consume vast amounts of information from:
- Academic papers
- Conference talks
- Online articles
- Internal discussions

Memoria's **autonomous research agent** works overnight to find connections, identify gaps, and suggest relevant literature.

---


---

## Privacy & Security

Memoria is built with a **privacy-first** approach:

- **Local-first**: Your knowledge graph is stored locally
- **API only**: Only chat messages are sent to AI providers
- **No telemetry**: No usage analytics or tracking
- **You own your data**: Export your knowledge anytime

---

## Collaboration

**Institutional Partner**: [Khazanah Nasional Berhad](https://www.khazanah.com.my)

For organizations interested in deploying Memoria for institutional knowledge management, please contact us.

---

## Contributing

Contributions are welcome! Areas where help is needed:

- Improving context compaction algorithms
- Adding new tool integrations
- Enhancing the autonomous research agent
- Building morning briefing templates
- Multi-language support

---

## License

MIT License - See [LICENSE](LICENSE) for details.

---

## Acknowledgments

- Built with [Next.js](https://nextjs.org), [FastAPI](https://fastapi.tiangolo.com), and [Anthropic](https://www.anthropic.com) APIs
- UI components from [shadcn/ui](https://ui.shadcn.com)
- Inspired by the science of learning and the problem of institutional memory

---

> *"The palest ink is better than the best memory, but an AI that understands is better than both."*
