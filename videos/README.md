# Memoria Promo Videos

A Remotion-based video generation system for creating polished, on-brand promo clips for Memoria, integrated with the Refactoring brand kit.

## Overview

This package uses [Remotion](https://www.remotion.dev/) to programmatically generate motion graphics that showcase Memoria's features. Videos stay faithful to Memoria's UI while using the Refactoring brand system for video overlays, titles, annotations, and styling.

### Brand Kit Integration

Videos use the **Refactoring brand kit** from the private `refactoringhq/brand` repo:

- **Fonts:** Refactoring Sans ExtraBold (display), Inter Tight (body), Refactoring Hand (annotations with `-0.05em` letter-spacing)
- **Colors:** Blue #155DFF (structure), Red #FC203A, Yellow #F0B100, Green #00B38B, Purple #A932FF
- **Assets:** 154 SVG icons (arrows, emphasis circles, scribbles, faces, logo, monogram) - ink is `currentColor`

**Important:** Brand assets are **private** and **not committed** to this public repo. They must be synced locally.

## Architecture

- **`src/components/`** - Reusable UI components (Stage, NoteCard, EditorView)
- **`src/lib/`** - Utilities (timing/easing, FLIP transitions)
- **`src/clips/`** - Individual video compositions
- **`src/styles.css`** - Memoria design tokens (synchronized with main app)

### Design Approach

**Two-Layer System:**

1. **Memoria UI Layer** (app authenticity)
   - Replicated components: `NoteCard`, `EditorView`, `Wikilink`
   - Uses Memoria's real CSS variables, typography, spacing from `src/index.css`
   - Stays faithful to the actual app look

2. **Brand Layer** (video polish)
   - Refactoring brand fonts, colors, assets from `refactoringhq/brand`
   - Title/end cards use Refactoring Sans ExtraBold
   - Annotations/captions use Refactoring Hand with hand-drawn arrows
   - Brand colors for emphasis (red circles, yellow highlights)
   - Logo/monogram on end cards

**Why Replicated:** Avoids Tauri IPC dependencies; keeps videos renderable standalone while matching the real app.

## Quick Start

### 1. Installation

This package is isolated from the root pnpm workspace to avoid affecting the main app build.

```bash
cd videos
pnpm install --ignore-workspace
```

### 2. Sync Brand Assets (Required for Full Branding)

Brand assets (fonts, SVGs, tokens) are private and must be synced from `refactoringhq/brand`:

```bash
cd videos
pnpm brand:sync
```

**Prerequisites:**
- GitHub CLI (`gh`) authenticated with access to `refactoringhq/brand`
- Run `gh auth status` to verify

**What gets synced** (into gitignored `videos/brand/`):
- `tokens/colors.json`, `tokens/variables.css`, `tokens/theme.css`
- `fonts/` (Refactoring Sans, Inter Tight, Refactoring Hand)
- `assets/` (154 SVG icons, arrows, emphasis shapes, logo, monogram)

If brand assets aren't synced, clips will render with fallback fonts/styles (still functional).

### 3. Preview a Clip

```bash
pnpm studio
```

Opens Remotion Studio for live preview and scrubbing.

### 4. Render a Clip

Since this package is isolated, use the local Remotion CLI:

```bash
./node_modules/.bin/remotion render wikilink-fan-out output/wikilink-fan-out.mp4
```

Or for still frames:

```bash
./node_modules/.bin/remotion still wikilink-fan-out output/frame.png --frame=240
```

## Creating a New Clip

1. **Create the composition** in `src/clips/YourClip.tsx`
2. **Register it** in `src/Root.tsx`:
   ```tsx
   <Composition
     id="your-clip"
     component={YourClip}
     durationInFrames={480}  // 8s @ 60fps
     fps={60}
     width={1920}
     height={1080}
   />
   ```
3. **Preview:** `pnpm studio`
4. **Render:** `pnpm render your-clip output/your-clip.mp4`

## Shared Infrastructure

### Stage Component

Provides the foundational environment:
- Dark background (#09090B by default, matching the reference style)
- Theme context (light/dark CSS variables)
- Safe framing with padding

```tsx
import { Stage } from '../components/Stage';

<Stage theme="dark">
  {/* Your content */}
</Stage>
```

### Timing & Easing

Located in `src/lib/timing.ts`:

- `easeOut(t)` - Strong ease-out curve (exponential-out, similar to cubic-bezier(0.16, 1, 0.3, 1))
- `easeInOut(t)`, `easeIn(t)` - Standard easing curves
- `mapRange(value, inMin, inMax, outMin, outMax, easingFn)` - Map with easing
- `staggerDelay(index, totalDelay, itemCount)` - Calculate micro-stagger for cascading animations

### FLIP Transitions

Located in `src/lib/transitions.ts`:

- `burstOutTransform(startCenter, endPosition, progress, rotation, easingFn)` - Elements exploding from a center point
- `calculateTransform(source, target, progress, easingFn)` - Generic FLIP transform
- `transformToCSS(transform)` - Convert transform object to React styles

## Sample Clip: WikilinkFanOut

**Duration:** 8 seconds @ 60fps (480 frames)

**Story:**
1. Editor fades in with a note
2. Wikilinks appear sequentially as if being typed
3. Editor slides left and scales down
4. Six linked notes burst out from the editor center with staggered timing and subtle rotation
5. Hold on final composition
6. Fade to black

**Timeline:**
- 0-0.75s: Editor fade in
- 0.75-3s: Wikilinks appear sequentially
- 3-4s: Editor scales/slides left
- 3.67-5.17s: Notes burst out (staggered, 0.2s apart)
- 5.17-7.5s: Hold
- 7.5-8s: Fade out

## Rendering Options

```bash
# High quality 1080p60
pnpm render wikilink-fan-out output/clip.mp4 --codec h264 --crf 18

# 4K
pnpm render wikilink-fan-out output/clip-4k.mp4 --scale 2

# Extract frames
pnpm render wikilink-fan-out output/ --sequence

# Preview without encoding
pnpm preview wikilink-fan-out
```

## Design Tokens

The package uses Memoria's design system. Update `src/styles.css` if design tokens change in the main app.

Key tokens:
- `--surface-app`, `--surface-card` - Background surfaces
- `--text-primary`, `--text-secondary` - Text colors
- `--border-default` - Borders
- `--accent-blue` - Primary accent (wikilinks, highlights)

## CI/CD Isolation

This package is intentionally isolated from the main app build:
- Separate `package.json` and `node_modules`
- Not included in root workspace
- Does not affect main app tests, lint, or build
- `.gitignore` excludes `videos/node_modules/`, `videos/output/`, and **`videos/brand/`** (private assets)

## Tips

- **Frame rates:** 60fps for smooth motion; 30fps acceptable for simpler clips
- **Duration:** Keep clips 5-10 seconds for social media
- **Easing:** Use `easeOut` for burst/exit animations; `easeInOut` for continuous motion
- **Stagger:** 0.1-0.3s stagger creates organic feel without feeling sluggish
- **Shadows:** Soft drop shadows separate floating elements from background
- **Hold time:** 2-3s final hold lets viewers absorb the composition
- **Brand overlays:** Use `BrandAnnotation` for hand-written notes, `BrandArrow` for pointing, `EmphasisCircle` for highlighting
- **Framing:** Hero content should fill 60-70% of frame; text must be legible on phone screens

## Brand Assets Security

**Critical:** Brand fonts and SVG assets from `refactoringhq/brand` are **private** and must **never** be committed to the public Memoria repo.

- Brand assets sync to `videos/brand/` (gitignored)
- Only color tokens (hex values, CSS vars) are referenced directly in code
- Render will work without brand sync (uses fallbacks) but won't have brand fonts/annotations
- Run `pnpm brand:sync` before rendering clips for external use
