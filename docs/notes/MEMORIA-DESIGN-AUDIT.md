# Memoria design audit — 30 October 2026

## Method

Ran the Impeccable 0.1.18 engine from the official GitHub release. The npm
mirror did not expose CLI 4.8.0, so no skill or hook was installed. Verified the
downloaded macOS ARM64 binary against the GitHub release SHA-256:
`543ee2f72036ad185dc9991ac3ba86b74d91f988f3d497776a088b8b65c8a9e1`.

Scanned these source files: NoteItem.tsx, SidebarParts.tsx, BreadcrumbBar.tsx,
EditorTheme.css, StatusBar.tsx, sidebar/SidebarSections.tsx. The source-pattern
scan returned no findings. This is not a usability or accessibility pass.

The rendered scan targeted the local browser preview at http://127.0.0.1:5202,
which displayed first-run AI onboarding, not the populated native workspace.
Native macOS WKWebView is not a Chromium CDP target; do not describe the browser
results as a scan of the installed app window.

## Rendered findings

1. Icon tile stacked above the "AI setup is optional" heading. Confirmed in
   AiAgentsOnboardingPrompt.tsx: the header uses a rounded size-16 icon container
   above a text-3xl title. Flatten the header and prioritise its task.
2. Nested card containers in onboarding. Review the rendered information panels
   and replace redundant boxes with spacing where grouping remains clear.
3. Small supporting text: detector measured 10.5px. Verify the computed size and
   root scaling before setting minimum readable text sizes.
4. Muted text contrast advisories: #787774 on white measured 4.48:1; on #fcfcfc,
   4.4:1. Darken the relevant text token and check both appearance modes.
5. Blue zero-offset shadow on body: possible preview/window-focus treatment.
   Investigate its source before changing native styling; not yet confirmed as
   unwanted decoration.

## Priorities for the working workspace

- First-run onboarding should explain opening a workspace before model/provider
  setup. Keep provider details available in Settings.
- Preserve useful focus indicators. Avoid treating every coloured border, common
  font, or rounded surface as inherently defective.
- Keep note navigation immediate. For menus and inspectors, use short,
  interruptible motion only where it clarifies a state change; honour reduced
  motion. No animation library is required for basic transitions.
- Test dark mode, keyboard focus, empty categories, long titles, and saving errors
  before further stylistic changes.

## Evidence

Raw source and rendered JSON reports were saved in the temporary OpenCode
directory as memoria-impeccable-audit.json and memoria-rendered-audit.json.
## Applied onboarding refinement

Removed the decorative header icon tile, flattened supporting information and
agent rows, reduced heading size, increased supporting text size and contrast,
and added balanced paragraph wrapping. Agent detection and continue/setup-later
actions are preserved. Five onboarding tests, TypeScript, and scoped lint passed.

A rendered browser rescan no longer reported the icon tile, nested cards, tiny
text, or low-contrast findings. It retained the previously unconfirmed body-shadow
finding and a paragraph-wrap advisory; text-pretty was then added for wrapping.
