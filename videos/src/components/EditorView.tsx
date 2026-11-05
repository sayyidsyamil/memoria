import type React from 'react';

interface EditorViewProps {
  content: React.ReactNode;
  style?: React.CSSProperties;
}

/**
 * EditorView - High-fidelity Memoria editor
 * Matches real editor typography, spacing, and styling from Editor.css
 */
export const EditorView: React.FC<EditorViewProps> = ({ content, style }) => {
  return (
    <div
      style={{
        backgroundColor: 'var(--surface-app)',
        padding: '40px 60px',
        maxWidth: '900px',
        width: '100%',
        ...style,
      }}
    >
      <div
        style={{
          fontSize: '15px',
          lineHeight: '1.6',
          color: 'var(--text-primary)',
          fontFamily: 'Inter, sans-serif',
          maxWidth: '760px',
          margin: '0 auto',
        }}
      >
        {content}
      </div>
    </div>
  );
};

interface WikilinkProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
  position?: { x: number; y: number };
}

/**
 * Wikilink - Exact Memoria wikilink styling from Editor.css
 * Dotted underline, subtle background, proper spacing
 */
export const Wikilink: React.FC<WikilinkProps> = ({ children, style, position }) => {
  return (
    <span
      className="wikilink-marker"
      data-position={position ? `${position.x},${position.y}` : undefined}
      style={{
        color: 'var(--accent-blue)',
        textDecoration: 'underline',
        textDecorationStyle: 'dotted',
        textUnderlineOffset: '2px',
        borderRadius: '2px',
        padding: '0 1px',
        cursor: 'pointer',
        ...style,
      }}
    >
      {children}
    </span>
  );
};
