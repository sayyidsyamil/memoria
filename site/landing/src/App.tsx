import { ArrowRightIcon, FileTextIcon, GithubLogoIcon } from '@phosphor-icons/react'
import summaryImage from '../../../docs/media/summary.webp'
import searchImage from '../../../docs/media/search.webp'
import './memoria.css'

const repository = 'https://github.com/sayyidsyamil/memoria'
const setup = `${repository}/blob/main/docs/DEVELOPMENT.md`

/** Memoria product page. Original interface; restrained treatment follows Unslop (CC BY 4.0). */
export default function App() {
  return <>
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="site-header">
      <a className="wordmark" href="#main">Memoria</a>
      <nav aria-label="Main navigation">
        <a href="#workflow">Workflow</a>
        <a href="#development">Development</a>
        <a href={repository} aria-label="Memoria on GitHub"><GithubLogoIcon size={18} />GitHub</a>
      </nav>
    </header>
    <main id="main">
      <section className="product-intro" aria-labelledby="product-title">
        <p className="eyebrow">Meeting intelligence / Research prototype</p>
        <h1 id="product-title">Keep the decision.<br />Keep the evidence.</h1>
        <div className="intro-detail">
          <p>Review a meeting, approve its outcomes, and use that knowledge to prepare the next conversation.</p>
          <a className="primary-link" href={setup}>Developer setup<ArrowRightIcon size={16} /></a>
        </div>
        <figure className="product-view">
          <a href={summaryImage} aria-label="View full-size native Summary"><img src={summaryImage} width="1600" height="1171" alt="Native Memoria Summary with approved outcomes and timestamp links" fetchPriority="high" /></a>
          <figcaption>Native macOS interface · Fictional Cedar review fixture</figcaption>
        </figure>
      </section>

      <section id="workflow" className="workflow" aria-labelledby="workflow-title">
        <div className="section-heading"><p className="eyebrow">From conversation to context</p><h2 id="workflow-title">A record you can return to</h2></div>
        <ol className="workflow-list">
          <li><span>01</span><div><h3>Capture and review</h3><p>Record microphone audio, mark moments, and edit the draft transcript. Speaker labels stay provisional until reviewed.</p></div></li>
          <li><span>02</span><div><h3>Approve what matters</h3><p>Inspect proposed outcomes and supporting quotes. Human approval makes knowledge durable; existing notes are preserved.</p></div></li>
          <li><span>03</span><div><h3>Find it and prepare</h3><p>Search saved transcripts, ask approved knowledge, or save a cited brief for the next meeting.</p></div></li>
        </ol>
      </section>

      <section className="evidence-section" aria-labelledby="evidence-title">
        <div><p className="eyebrow">Timestamp → quote → outcome</p><h2 id="evidence-title">Sources stay within reach</h2><p>Keyword matches and approved claims link back to the original meeting. Quotes establish provenance, not factual truth.</p><a className="text-link" href={`${repository}/blob/main/docs/UI-PATTERNS.md`}>Interface principles<ArrowRightIcon size={16} /></a></div>
        <figure><a href={searchImage} aria-label="View full-size Search results"><img src={searchImage} width="1600" height="1209" alt="Cedar search results with highlighted evidence and source timestamps" loading="lazy" /></a><figcaption>Keyword search, with inspectable source locations</figcaption></figure>
      </section>

      <section id="development" className="development" aria-labelledby="development-title">
        <div><p className="eyebrow">Built in the open</p><h2 id="development-title">Local files. Reviewed knowledge.</h2><p>React and TypeScript · Tauri and Rust · Python and MLX · Markdown and SQLite</p></div>
        <div className="development-notes"><p>Currently evaluated on Apple Silicon macOS. Native models require separately configured Python environments and cached weights; there is no supported standalone installer yet.</p><p>Speech quality, long-session recovery, and native acceptance remain in progress. Optional inherited integrations may use the network.</p><a className="text-link" href={`${repository}/blob/main/docs/ROADMAP.md`}><FileTextIcon size={16} />Roadmap and acceptance criteria</a></div>
      </section>
    </main>
    <footer className="site-footer"><p>Memoria · FYP2 by Sayyid Syamil</p><p>Derived from <a href="https://github.com/refactoringhq/tolaria">Tolaria</a> · <a href={`${repository}/blob/main/NOTICE.md`}>AGPL-3.0-or-later and attribution</a></p></footer>
  </>
}
