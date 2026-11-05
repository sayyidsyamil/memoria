# Memoria Web: deliberate UI departures

Standing rule (Luca, 10 Oct 2026): Memoria Web reuses the desktop shell, BlockNote editor, components, tokens, typography, icons and dark mode. Where the web demands something different, the change is made deliberately and recorded here: what, why, where. Karn copies this list into the vault note `memoria-vault-remote-v1`.

## Departures made

B3-3 (TOL-24) adapts the shell to touch. It reuses the existing context menus, `Button`, Phosphor icons, tokens and copy; only the input layer, the target sizes and the empty editor change, and only while a finger is the primary pointer. The departures are the first rows of the table. ADR 0288.

B3-2 (TOL-194) gives the shell a tablet layout and browser-safe shortcuts. It reuses the sidebar, its collapse and expand controls, the note list, editor and tokens unchanged; the departures are the first rows of the table. ADR 0287.

B5-3 (TOL-237) adds sharing, the second web-only surface after login. It reuses the shadcn `Dialog`, `Input`, `Select`, `Button` and `Badge`, Phosphor icons, the note bar's icon buttons, the archived-note banner's style and the status bar's ghost buttons; the departures are the first rows of the table. ADR 0298.

B3-1 (TOL-193) gives the shell a phone layout. It reuses the note list, editor, status bar, `Button`, Phosphor icons and tokens unchanged; the departures are the first rows of the table. ADR 0286.

Spike S4 (TOL-8) adds the first web-only surface, the collaborative note page. It reuses the editor, its theme, the shadcn components and the design tokens; the departures are in the table.

Spike S3 (TOL-5) adds the server and the protocol package and touches no UI.

Spike S1 (TOL-3, TOL-4) builds the existing shell as a static web bundle without changing any component, style, token or copy. `apps/web/` contains build and test configuration only.

| Date | What changed | Why | Where |
|---|---|---|---|
| 25 Oct 2026 | A Share button (Phosphor `ShareNetwork`) in the note bar, next to the presence avatars, outside the overflow menu; it opens a Share dialog: this note or the whole vault, an email or GitHub username, "Can edit" or "Can view", and the people with access with their role and a remove button | Sharing is web-only (accounts live in the hosted service); the note bar is the one place every layout shows, phone included | `src/components/sharing/ShareNoteButton.tsx`, `ShareDialog.tsx`, `ShareInviteForm.tsx`, `SharePeopleList.tsx` |
| 25 Oct 2026 | A "Shared with me" entry in the web status bar (an icon in the own vault; "Shared · Can edit" or "Shared · View only" in a shared one) that lists what others shared and opens it; in the own vault it also offers "Share my vault" | The phone layout hides the sidebar, and the status bar is visible in every layout | `src/components/sharing/SharingStatusButton.tsx`, `SharedWithMeDialog.tsx` |
| 25 Oct 2026 | A vault shared with the user opens as its own page at `/vaults/<id>/` (a full navigation), not in the desktop's vault switcher | Each vault has its own backend, cache and live documents; the switcher manages local folders the web does not have | `src/lib/sharing/sharedVaultLocation.ts`, `src/lib/vaultBackend/remoteConfig.ts` |
| 25 Oct 2026 | A viewer's note shows a "View only" banner above a read-only editor, in the archived-note banner's style | The desktop has no notion of a note someone else may only read | `src/components/sharing/SharedReadOnlyBanner.tsx` |
| 25 Oct 2026 | When the owner revokes a share that is open, a dialog that cannot be dismissed says "Access removed" and offers "Shared with me" or "Go to my vault"; the page stops reconnecting | The note is gone for this user; a reconnect loop or an empty editor would not say why | `src/components/sharing/AccessRevokedDialog.tsx` |
| 24 Oct 2026 | With a finger (`pointer: coarse`), a long press (500 ms) on a note, a type, a view or a folder opens the menu a right click opens; the lifted finger does not also open the note. A mouse keeps the right click | iOS Safari sends no right click for a long press and touch has no hover; the desktop's menus are the only way to rename, archive, delete or customize | `src/lib/touchInput.ts` (installed in `src/main.tsx`) |
| 24 Oct 2026 | With a finger, the note list header controls, the sidebar's icon buttons and rows, the phone back button and context menu items are at least 44 × 44 px; the header's icons lose their gaps, which the hit areas now provide | Apple and Google ask for 44 px targets; 14–24 px icons are missed by a finger | `src/App.css` (`html[data-touch-input]`) |
| 24 Oct 2026 | With a finger, the sidebar and note list do not select text or show the iOS callout on a long press; text fields still do | The long press belongs to the menu | `src/App.css` |
| 24 Oct 2026 | In the browser the macOS traffic-light inset of the note list header shrinks to the 16 px edge margin on touch devices | A browser has no window buttons to clear; the 90 px inset hid the header's title on an iPad | `src/App.css` |
| 24 Oct 2026 | With a finger, the empty editor reads "Tap a note to start editing" and offers "Search notes" and "Create new note" buttons instead of keyboard chords | A touch screen usually has no keyboard; the chords did nothing for it | `src/components/TouchEmptyState.tsx`, `src/components/EditorLayout.tsx` |
| 24 Oct 2026 | On a tablet (641–1366 px with a touch pointer) the shell opens with two panes, the note list and the note; the sidebar is collapsed until asked for, for the session, without changing the vault's view mode | The editor was clipped at 834 px; a touch screen of that size reads two panes best | `src/hooks/useTabletSidebar.ts`, `src/App.css` (`html[data-tablet-layout]`) |
| 24 Oct 2026 | In tablet portrait the open sidebar floats over the note list with a shadow, without a resize handle, and a tap beside it closes it | Three panes do not fit 834 px; iPadOS floats sidebars the same way | `src/hooks/useTabletSidebar.ts`, `src/App.css` |
| 24 Oct 2026 | On the web, new note, quick open and the view modes are ⌥⌘N, ⌥⌘P and ⌥⌘1/2/3 (Ctrl+Alt off Apple keyboards); ⌘N, ⌘P, ⌘1–3, zoom, ⌘D, ⌘E, ⌘, and the ⌘⇧ panel toggles are left to the browser and no longer shown as hints; the empty editor shows the web chords | The browser owns those shortcuts or users expect its action (print, bookmark, page zoom) | `src/hooks/webShortcuts.ts`, `src/hooks/appCommandCatalog.ts`, `src/components/EditorLayout.tsx` |
| 24 Oct 2026 | At phone width (≤ 640 px) the shell shows one pane, the note list or the note, instead of three side by side; the sidebar and resize handles are hidden | The editor was off-screen and unreachable by touch at 393 px | `src/hooks/usePhoneNoteStack.ts`, `src/App.css` (`html[data-phone-pane]`) |
| 24 Oct 2026 | A "‹ Notes" back bar above the note on the phone; browser back also returns to the list, because the list's URL names no note | A phone has no list beside the note to go back to; the desktop's breadcrumb back/forward walk note history, not panes | `src/components/phone/PhoneNoteBackBar.tsx` (in `LazyEditor`), `src/hooks/useWebRouting.ts` |
| 24 Oct 2026 | On the phone the shell is sized to the visual viewport and padded by the safe-area insets (`viewport-fit=cover`); the caret is scrolled back above the on-screen keyboard | Phone browsers: notch, home indicator and a keyboard that covers the bottom of the page | `src/hooks/useKeyboardAwareViewport.ts`, `src/App.css`, `index.html` |
| 12 Oct 2026 | A standalone collaborative note page (`/apps/web/collab.html?note=<path>`) instead of the three-pane shell | The shell swaps markdown into one editor instance; a live document needs an editor created for it. A page of its own proves the multiplayer path first and works on a phone, which the shell does not yet | `apps/web/collab.html`, `apps/web/src/collab/` |
| 12 Oct 2026 | Presence avatars in the note header: overlapping circles with initials, coloured per person, name in a tooltip, the viewer marked "(you)" | Multiplayer UI ships in the first beta; the desktop has no notion of other people | `apps/web/src/collab/PresenceAvatars.tsx` |
| 12 Oct 2026 | Live cursors and selections of other people in the editor, labelled with their name while they are active | Same. BlockNote's collaboration cursors with their default styling, in the person's presence colour | `apps/web/src/collab/CollabEditor.tsx` |
| 12 Oct 2026 | A sync status badge ("Connecting…", "Syncing…", "All changes synced", "Offline. Your changes are kept…") in place of the desktop status bar's git controls | On the web the user does not commit or push; what matters is whether edits have reached the server | `apps/web/src/collab/CollabStatusBadge.tsx` |
| 12 Oct 2026 | A notice naming the conflict copy when edits could not be merged with a change from another device | The desktop resolves conflicts in a git dialog; here the server has already kept both versions | `apps/web/src/collab/CollabStatusBadge.tsx` |
| 12 Oct 2026 | A connect form asking for server token, name and note path | Stand-in for login and navigation, which belong to later work; the token stays in session storage | `apps/web/src/collab/ConnectForm.tsx` |
| 12 Oct 2026 | Note header and editor laid out with `100dvh` and safe-area insets; avatars are not focus targets (name exposed as an image label) | Phone browsers: virtual keyboard, notch, no hover | `apps/web/src/collab/collab.css` |

## Known gaps that will become departures

Found while running the unchanged shell in a browser and in iPhone and iPad emulation. They are listed so the first web UI work starts from evidence; none of them has been changed. Details and measurements are in [s1-tauri-inventory.md](s1-tauri-inventory.md).

| Area | What the unchanged shell does on the web | Likely adaptation |
|---|---|---|
| Phone sidebar | Since TOL-193 the phone shows the list or the note; the sidebar (types, saved views, favorites) is hidden and not reachable yet | A sidebar pane before the list in the same stack |
| Status bar | Git branch, changes, commit, sync and history controls | Sync and connection status, including offline and conflict states |
| Web-only surfaces | Absent | Login, account, sharing and permissions dialogs, add to home screen |
| Multiplayer | Present on the collaborative note page (S4); absent in the shell | Bring the page's presence, cursors and status into the shell; sharing state |
| Touch | Since TOL-24 menus open with a long press and key targets are 44 px; the status bar and the editor toolbars keep their desktop sizes, and hover tooltips appear on tap | Status bar replaced by sync status (above); tooltips off for touch |
