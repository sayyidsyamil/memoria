# Memoria Web S2: testing the editor on a real iPad and iPhone

Spike S2 (TOL-6). The question is whether BlockNote is usable in Safari on iOS and iPadOS. Emulation in Playwright WebKit (see [s1-tauri-inventory.md](s1-tauri-inventory.md)) proves the bundle loads and accepts synthetic typing; it says nothing about the virtual keyboard, IME, selection handles or paste. Those need hands on a device.

The bundle under test is the static web build from S1: the unchanged desktop shell with demo data from `src/mock-tauri/`. Nothing is saved anywhere; a reload resets every note.

## Safety rules

- The preview server binds to `127.0.0.1` unless you opt in. Only opt in on a private network (Tailscale, or home Wi-Fi you control).
- Never bind to a public interface, open a firewall port, or put this behind a public tunnel.
- Never use `--host 0.0.0.0` (or bare `--host`) on the Hetzner agent boxes: they have public IPv4 addresses, so that binds the bundle to the internet. Always name a private address.
- Stop the server when the session ends (`Ctrl+C`). Do not leave it running in the background.
- The bundle contains demo notes only. Do not point it at a real vault.

## Build and serve

From the repository root, on the machine that will serve the bundle:

```bash
pnpm install
pnpm build:web            # emits apps/web/dist (about 45 s)
```

Check it locally first (loopback only):

```bash
pnpm preview:web          # http://127.0.0.1:4173
```

Serve it to a device over Tailscale (recommended, works from anywhere, nothing public):

```bash
tailscale ip -4                                   # e.g. 100.x.y.z
MEMORIA_WEB_HOST="$(tailscale ip -4)" pnpm preview:web
# on the iPad or iPhone (Tailscale app connected): http://100.x.y.z:4173
```

Binding to the Tailscale address keeps the server off every other interface. To use the MagicDNS name instead of the IP, allow that host name:

```bash
MEMORIA_WEB_HOST="$(tailscale ip -4)" \
MEMORIA_WEB_ALLOWED_HOSTS="agent-claude.your-tailnet.ts.net" \
pnpm preview:web
```

Serve it on the local network instead (device on the same Wi-Fi):

```bash
pnpm preview:web --host 192.168.1.20      # this machine's LAN address
# on the device: http://192.168.1.20:4173
```

| Setting | Default | Purpose |
|---|---|---|
| `MEMORIA_WEB_HOST` or `--host <addr>` | `127.0.0.1` | Address to bind |
| `MEMORIA_WEB_PORT` or `--port <n>` | `4173` | Port (the server exits if it is taken) |
| `MEMORIA_WEB_ALLOWED_HOSTS` | empty | Comma-separated host names accepted in the `Host` header. IP addresses are always accepted |

Stop with `Ctrl+C`, then confirm nothing is listening:

```bash
ss -ltnp | grep 4173 || echo "nothing listening on 4173"
```

### Notes for the tester

- **Plain HTTP limits.** Over `http://` Safari disables the async clipboard API, service workers and add to home screen as an app. Typing, selection, IME and ordinary paste from the callout menu still work. If one of those limits blocks a check, record it as "needs HTTPS" (`tailscale serve` can provide a tailnet-only HTTPS URL; do not use `tailscale funnel`, which is public).
- **Phone layout is not adapted yet.** On an iPhone the editor is off-screen. Use the iPad for the editor checks, or rotate the phone to landscape; record what the phone shows as-is.
- **Remote debugging.** Connect the device to a Mac, enable Web Inspector (Settings, Safari, Advanced) and use Safari's Develop menu to read console errors.
- Expected console noise: 404s for `/api/vault/ping` and a failed WebSocket to `localhost:9711`. Both come from desktop-only helpers and are harmless here.

## Automated pre-check (no device)

```bash
pnpm build:web
pnpm playwright:web       # Chromium, WebKit, iPhone 15, iPad Pro 11 (portrait and landscape)
```

All ten checks should pass before spending device time. Screenshots and `layout.json` per project land in `test-results/web/`.

## Checklist

Run on the iPad first, then the iPhone. For each row record pass, fail or partial, the device and OS version, and a screenshot or screen recording for anything that is not a clean pass.

Open the note **Build Laputa App** (a long note with headings, nested lists, code and links) unless a row says otherwise.

### Typing

| # | Check | Expected |
|---|---|---|
| T1 | Tap in a paragraph and type a sentence | Characters appear at the caret, no lag, no dropped or doubled letters |
| T2 | Type quickly for 10 seconds | No stutter; the caret never jumps |
| T3 | Autocorrect and autocapitalisation | Suggestions apply once; no duplicated words |
| T4 | Press Return in a paragraph, in a list item, on an empty list item | New block; new item; exits the list |
| T5 | Backspace at the start of a block | Merges with the previous block |
| T6 | Double-space full stop, smart quotes, dictation | Text lands correctly |
| T7 | Hardware keyboard (iPad): arrows, Shift+arrows, Cmd+B, Cmd+I, Cmd+Z | Behave as on desktop |

### Selection

| # | Check | Expected |
|---|---|---|
| S1 | Double-tap a word | Word selected, handles visible |
| S2 | Drag the handles across blocks | Selection extends across blocks without jumping |
| S3 | Long-press and move the caret (loupe) | Caret follows the finger |
| S4 | Apply bold or a link from the formatting toolbar | Toolbar reachable and not hidden by the iOS callout menu |
| S5 | Tap away | Selection clears, no stuck toolbar |

### Virtual keyboard

| # | Check | Expected |
|---|---|---|
| K1 | Focus the last paragraph of a long note | The caret scrolls above the keyboard |
| K2 | Type until the text wraps past the keyboard edge | The view follows the caret |
| K3 | Dismiss and reopen the keyboard | Layout returns; nothing stays shifted |
| K4 | Rotate with the keyboard open | No broken layout, caret still visible |
| K5 | Floating toolbars and the slash menu with the keyboard open | Visible and tappable, not under the keyboard |
| K6 | Status bar and floating AI button | Not covering the text being typed |

### IME and international input

| # | Check | Expected |
|---|---|---|
| I1 | Chinese Pinyin: compose a phrase, choose a candidate | Only the chosen text is inserted; no stray Latin letters |
| I2 | Japanese Kana: compose, convert, confirm | Same |
| I3 | Type `/` during composition | The slash menu does not open mid-composition |
| I4 | Emoji keyboard and accent long-press (é) | Inserted once |
| I5 | Return while composing | Confirms the candidate; does not split the block |

### Paste

| # | Check | Expected |
|---|---|---|
| P1 | Paste plain text from Notes | Inserted at the caret |
| P2 | Paste rich text from a web page (headings, lists, links) | Structure preserved as blocks |
| P3 | Paste markdown text | Converted to blocks |
| P4 | Paste a URL onto a selection | Becomes a link |
| P5 | Paste an image from Photos | Appears in the note (inline data in this build) |
| P6 | Cut, copy and paste inside the note | Round-trips blocks |

### Blocks

| # | Check | Expected |
|---|---|---|
| B1 | Type `/` and pick a heading, bullet list, checklist, code block, table | Menu opens, scrolls and inserts by tap |
| B2 | Toggle a checklist item by tap | Toggles once |
| B3 | Indent and outdent a list item | Works from the toolbar or keyboard |
| B4 | Edit a table cell; add a row and a column | Cell focus and handles usable by touch |
| B5 | Drag a block by its handle | Possible by touch, or record that it is not |
| B6 | Type `[[` and pick a note | Wikilink menu opens and inserts |
| B7 | Tap a wikilink | Opens the target note |
| B8 | Code block: type, Return, Tab | Stays inside the block |

### Undo and redo

| # | Check | Expected |
|---|---|---|
| U1 | Type, then undo with the keyboard's undo or a three-finger swipe left | Reverts the typing in sensible steps |
| U2 | Redo with three-finger swipe right | Restores it |
| U3 | Shake to undo (iPhone) | Either works or does nothing; must not corrupt the note |
| U4 | Undo after paste and after a block insert | Reverts the whole action |
| U5 | Open a different note, then undo | Does not bring back the previous note's content |

### Long-note scrolling

| # | Check | Expected |
|---|---|---|
| L1 | Scroll **Build Laputa App** top to bottom with a flick | Smooth, no blank regions |
| L2 | Scroll while the keyboard is open | Caret is not dragged back into view against the scroll |
| L3 | Tap the status bar area to jump to the top | Jumps, or record that it does not |
| L4 | Rubber-band at the top and bottom | The page itself does not bounce or reveal a white gap |
| L5 | Scroll the note list (about 9,000 demo entries) | Smooth; taps open the right note |
| L6 | Type at the bottom of a long note for a minute | No growing lag |

## Reporting

For each failed or partial row: the row id, device and OS, what happened, a recording, and whether it blocks editing or is cosmetic. The decision S2 feeds is the fallback named in the plan: if typing, IME or selection is not fixable, phones get a CodeMirror raw-markdown editor instead of BlockNote.
