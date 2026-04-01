# Memoria

**A Self-Learning Personal Knowledge Agent with Persistent Memory and Autonomous Knowledge Discovery**

---

## 🧠 What is Memoria?

Memoria is an AI-powered personal knowledge agent that listens to meetings, lectures, and online content, then automatically generates structured notes, extracts key facts and concepts, and stores everything into a persistent knowledge graph that you can search, edit, and explore.

While you sleep, a background research agent reviews the day's knowledge, identifies gaps and open questions, searches the internet for relevant information, and enriches the knowledge graph with new connections and findings. You wake up to a morning briefing showing what Memoria learned overnight and what surprising connections it found across sessions.

### The Problem Memoria Solves

The average knowledge worker attends **25.6 meetings per week** (Otter.ai, 2025 Meeting Statistics Report). The average university student sits through **15 to 20 hours of lectures weekly**. In both cases, information is delivered, discussed, and then largely forgotten.

Ebbinghaus (1885) demonstrated that without active reinforcement, people lose roughly **two-thirds of new information within a single day**. But forgetting is not even the biggest problem.

The bigger problem is that the connections between what was said in Monday's meeting, what was taught in Wednesday's lecture, and what was read in Friday's article are **never made**. Those connections are where real insight lives, and they are lost because human memory cannot search across contexts.

Existing note-taking tools like Notion and Otter.ai treat each session as an island. They transcribe, they summarize, and they file. **They do not understand, connect, or grow.**

---

## ✨ Features

### 🎙️ **Intelligent Ingestion**
- Ingest audio from YouTube URLs
- Transcribe meetings and lectures via Groq Whisper (large-v3-turbo)
- Process transcripts with low Word Error Rate (< 5%)

### 🧩 **Automatic Ontology Extraction**
- Extract key concepts, entities, and relationships using LLM
- Identify important facts and ideas automatically
- Generate structured notes from unstructured content

### 🔗 **Persistent Knowledge Graph**
- Store everything in a SQLite relational database
- Visualize connections between concepts from different contexts
- Surface relationships between ideas that came from completely different sources
- Interactive graph exploration with force-directed layout

### 🤖 **Autonomous Research Agent**
- Runs while you sleep
- Reviews daily knowledge for gaps and open questions
- Searches the internet for relevant information
- Enriches the knowledge graph with new connections and findings
- Delivers morning briefings of overnight discoveries

### 🖥️ **Terminal Interface**
- Command-line style interaction
- Quick commands: `/ingest`, `/extract`, `/query`, `/help`
- Real-time streaming responses
- Beautiful dark chrome aesthetic

---

## 🚀 Tech Stack

- **Frontend**: Next.js 16, React 19, TypeScript, Tailwind CSS v4
- **Backend**: FastAPI (Python)
- **AI/ML**: Groq Whisper, LLM for ontology extraction
- **Database**: SQLite with knowledge graph structure
- **UI Components**: shadcn/ui

---

## 🛠️ Installation

### Prerequisites
- Node.js 18+ and pnpm
- Python 3.11+

### Setup

```bash
# Clone the repository
git clone https://github.com/sayyidsyamil/memoria.git
cd memoria

# Install Node.js dependencies
pnpm install

# Install Python dependencies
pip install -r requirements.txt

# Run development server (starts both Next.js and FastAPI)
pnpm dev
```

The app will be available at `http://localhost:3000`

---

## 📖 Usage

### Available Commands

| Command | Description |
|---------|-------------|
| `/ingest <url>` | Ingest audio from YouTube URL |
| `/extract` | Extract ontology from transcript |
| `/query <text>` | Query the knowledge graph |
| `/clear` | Clear terminal output |
| `/help` | Show available commands |

### Example Workflow

1. **Ingest a lecture**: `/ingest https://youtube.com/damodaran_lecture_3`
2. **Extract concepts**: `/extract`
3. **Query knowledge**: `/query What is WACC?`

---

## 🏢 Use Case: Khazanah Nasional Berhad

For organizations like **Khazanah Nasional Berhad**, where investment analysts attend dozens of meetings weekly and institutional knowledge directly impacts billion-ringgit decisions, Memoria ensures that:

- **No insight is lost** - Every meeting, every lecture, every article is captured
- **No connection is missed** - The system surfaces relationships between ideas from different contexts
- **Knowledge compounds** - Over weeks and months, Memoria builds a growing map of everything encountered

---

## 🔒 Privacy-First Approach

Memoria is built with privacy at its core:
- Local SQLite database for personal knowledge storage
- No third-party data sharing without explicit consent
- User controls all data retention and deletion policies

---

## 📸 Screenshots

### Terminal View
The main interface with command input and streaming output showing system logs, extracted entities, and relationship links.

### Knowledge Graph View
Interactive canvas visualization showing concept nodes (WACC, Cost of Equity, Risk-Free Rate, etc.) connected by relationship edges.

---

## 🤝 Collaboration

**Partner Organization**: Khazanah Nasional Berhad

This project is developed in collaboration with Khazanah Nasional Berhad as part of a research initiative to enhance institutional knowledge management and decision-making processes.

---

## 📚 Research Foundation

- **Ebbinghaus Forgetting Curve** (1885) - Demonstrates the exponential nature of forgetting
- **Knowledge Graph Theory** - Connecting entities and relationships for semantic understanding
- **Active Learning** - Reinforcement through spaced repetition and contextual connections

---

## 🗺️ Roadmap

- [ ] Integration with Zoom/Teams for live meeting transcription
- [ ] Mobile app for on-the-go knowledge capture
- [ ] Advanced graph analytics and clustering
- [ ] Export to various formats (PDF, Notion, Obsidian)
- [ ] Team/collaborative knowledge sharing
- [ ] Voice interface for hands-free interaction

---

## 📄 License

This project is proprietary and developed for academic and research purposes.

---

## 👤 Author

**Sayyid Syamil** - Developer & Researcher

---

*Memoria turns passive listening into active, compounding knowledge.*
