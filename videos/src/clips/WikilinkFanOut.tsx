import type React from 'react';
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
} from 'remotion';
import { Stage } from '../components/Stage';
import { EditorView, Wikilink } from '../components/EditorView';
import { NoteCard } from '../components/NoteCard';
import { easeOut } from '../lib/timing';
import { burstOutTransform, transformToCSS } from '../lib/transitions';

/**
 * WikilinkFanOut - Polished Memoria promo clip
 * Shows a realistic meeting note with wikilinks, then linked notes burst out
 * Duration: 8 seconds @ 60fps = 480 frames
 *
 * Timeline:
 * 0-30 (0-0.5s): Editor fades in with note title
 * 30-90 (0.5-1.5s): Note content appears line by line
 * 90-120 (1.5-2s): First wikilink highlights
 * 120-150 (2-2.5s): Second wikilink highlights
 * 150-180 (2.5-3s): Third wikilink highlights
 * 180-240 (3-4s): Editor scales down slightly and shifts left
 * 220-340 (3.67-5.67s): Six notes burst out from wikilink positions (staggered)
 * 340-450 (5.67-7.5s): Hold on final composition with subtle connecting lines
 * 450-480 (7.5-8s): Fade to black
 */
export const WikilinkFanOut: React.FC = () => {
  const frame = useCurrentFrame();

  // Editor fade in
  const editorFadeIn = interpolate(frame, [0, 30], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Content reveals
  const showTitle = frame >= 30;
  const showLine1 = frame >= 45;
  const showLine2 = frame >= 60;
  const showLine3 = frame >= 75;
  const showLine4 = frame >= 90;

  // Wikilink highlights (subtle pulse)
  const wikilink1Highlight = interpolate(frame, [90, 120], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const wikilink2Highlight = interpolate(frame, [120, 150], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const wikilink3Highlight = interpolate(frame, [150, 180], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Editor transform (subtle scale down & shift left)
  const editorTransform = interpolate(
    frame,
    [180, 240],
    [0, 1],
    {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: easeOut,
    }
  );

  const editorX = -180 * editorTransform;
  const editorScale = 1 - 0.15 * editorTransform;

  // Linked notes - realistic meeting context
  const linkedNotes = [
    { title: 'Sarah Chen', icon: '👤', typeColor: '#78A4FF', preview: 'Product Manager · Leads design system initiative' },
    { title: 'Q4 Roadmap', icon: '🎯', typeColor: '#79D89D', preview: 'Mobile app launch, API v3 migration, analytics dashboard' },
    { title: 'Design Tokens', icon: '🎨', typeColor: '#F3A15B', preview: 'Color system, typography scale, spacing guidelines' },
    { title: 'Component Library', icon: '📦', typeColor: '#B69CFF', preview: 'Reusable UI primitives and patterns' },
    { title: 'Accessibility Audit', icon: '♿', typeColor: '#64D1C8', preview: 'WCAG 2.1 AA compliance review and fixes' },
    { title: 'User Research', icon: '🔍', typeColor: '#F28AC3', preview: 'Interview findings from 12 power users' },
  ];

  // Burst positions - arranged in a tidy grid
  const notePositions = [
    { x: 1160, y: 280, rotate: -2 },
    { x: 1500, y: 280, rotate: 1 },
    { x: 1160, y: 480, rotate: 1 },
    { x: 1500, y: 480, rotate: -1 },
    { x: 1160, y: 680, rotate: -1 },
    { x: 1500, y: 680, rotate: 2 },
  ];

  // Wikilink screen positions (approximate, for burst origin)
  const wikilinkPositions = [
    { x: 550, y: 450 }, // Sarah
    { x: 620, y: 490 }, // Q4 Roadmap
    { x: 580, y: 530 }, // component library
  ];

  // Map each note to its burst origin
  const noteBurstOrigins = [
    wikilinkPositions[0], // Sarah -> from "Sarah Chen"
    wikilinkPositions[1], // Q4 Roadmap -> from "Q4 Roadmap"
    wikilinkPositions[2], // Design Tokens -> from "component library"
    wikilinkPositions[2], // Component Library -> from "component library"
    wikilinkPositions[0], // Accessibility -> from "Sarah Chen"
    wikilinkPositions[1], // User Research -> from "Q4 Roadmap"
  ];

  // Final fade out
  const fadeOut = interpolate(frame, [450, 480], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <Stage theme="dark" background="#09090B">
      <AbsoluteFill style={{ opacity: fadeOut }}>
        {/* Editor View */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: `translate(-50%, -50%) translateX(${editorX}px) scale(${editorScale})`,
            opacity: editorFadeIn,
            zIndex: 10,
            width: '900px',
          }}
        >
          <EditorView
            content={
              <>
                {showTitle && (
                  <div style={{ 
                    fontSize: '28px', 
                    fontWeight: 600, 
                    marginBottom: '24px',
                    color: 'var(--text-primary)',
                  }}>
                    Product Sync — Dec 15
                  </div>
                )}
                {showLine1 && (
                  <p style={{ margin: '12px 0', opacity: showLine2 ? 1 : 0.7 }}>
                    Met with <Wikilink>Sarah Chen</Wikilink> to finalize the{' '}
                    <Wikilink>Q4 Roadmap</Wikilink>. Key priorities:
                  </p>
                )}
                {showLine2 && (
                  <ul style={{ 
                    margin: '12px 0', 
                    paddingLeft: '24px',
                    opacity: showLine3 ? 1 : 0.7,
                  }}>
                    <li style={{ margin: '6px 0' }}>Launch mobile app (target: Jan 15)</li>
                    <li style={{ margin: '6px 0' }}>Complete <Wikilink>component library</Wikilink> audit</li>
                  </ul>
                )}
                {showLine3 && (
                  <p style={{ margin: '12px 0', opacity: showLine4 ? 1 : 0.7 }}>
                    Design system work continues next sprint. Sarah will coordinate with eng.
                  </p>
                )}
                {showLine4 && (
                  <p style={{ 
                    margin: '16px 0 0', 
                    fontSize: '13px', 
                    color: 'var(--text-secondary)',
                  }}>
                    Action items → Linear
                  </p>
                )}
              </>
            }
          />
        </div>

        {/* Burst-out notes with connecting lines */}
        {frame >= 220 &&
          linkedNotes.map((note, index) => {
            const startFrame = 220 + index * 18; // Stagger by 0.3s
            const endFrame = startFrame + 120; // 2s animation

            const progress = interpolate(
              frame,
              [startFrame, endFrame],
              [0, 1],
              {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
              }
            );

            const targetRect = {
              x: notePositions[index].x,
              y: notePositions[index].y,
              width: 280,
              height: 100,
            };

            const burstOrigin = noteBurstOrigins[index];

            const transform = burstOutTransform(
              burstOrigin,
              targetRect,
              progress,
              notePositions[index].rotate,
              easeOut
            );

            // Connecting line (faint, appears after note settles)
            const lineOpacity = interpolate(
              frame,
              [endFrame, endFrame + 30],
              [0, 0.15],
              {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
              }
            );

            return (
              <div key={index}>
                {/* Connecting line from burst origin to note */}
                {frame >= endFrame && (
                  <svg
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      width: '100%',
                      height: '100%',
                      pointerEvents: 'none',
                      zIndex: 4,
                      opacity: lineOpacity,
                    }}
                  >
                    <line
                      x1={burstOrigin.x}
                      y1={burstOrigin.y}
                      x2={transform.x}
                      y2={transform.y}
                      stroke="var(--accent-blue)"
                      strokeWidth="1.5"
                      strokeDasharray="4 4"
                      opacity="0.3"
                    />
                  </svg>
                )}

                {/* Note card */}
                <div
                  style={{
                    position: 'absolute',
                    left: '0',
                    top: '0',
                    zIndex: 5 + index,
                    ...transformToCSS(transform),
                  }}
                >
                  <NoteCard
                    title={note.title}
                    preview={note.preview}
                    icon={note.icon}
                    typeColor={note.typeColor}
                    rotate={notePositions[index].rotate * progress}
                  />
                </div>
              </div>
            );
          })}
      </AbsoluteFill>
    </Stage>
  );
};
