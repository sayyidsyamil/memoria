import type React from 'react';

interface NoteCardProps {
  title: string;
  preview?: string;
  icon?: string;
  typeColor?: string;
  style?: React.CSSProperties;
  scale?: number;
  rotate?: number;
}

/**
 * NoteCard - High-fidelity Memoria note card
 * Matches NoteItem.tsx styling from the real app
 */
export const NoteCard: React.FC<NoteCardProps> = ({
  title,
  preview,
  icon,
  typeColor,
  style,
  scale = 1,
  rotate = 0,
}) => {
  return (
    <div
      style={{
        backgroundColor: 'var(--surface-card)',
        border: '1px solid var(--border-default)',
        borderRadius: '6px',
        padding: '10px 12px',
        minWidth: '220px',
        maxWidth: '320px',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.12), 0 1px 3px rgba(0, 0, 0, 0.08)',
        transform: `scale(${scale}) rotate(${rotate}deg)`,
        transformOrigin: 'center center',
        cursor: 'pointer',
        transition: 'box-shadow 0.15s',
        ...style,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15), 0 2px 6px rgba(0, 0, 0, 0.1)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.12), 0 1px 3px rgba(0, 0, 0, 0.08)';
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: preview ? '6px' : '0' }}>
        {icon && (
          <div
            style={{
              fontSize: '16px',
              lineHeight: '1',
              flexShrink: 0,
              color: typeColor || 'var(--text-secondary)',
            }}
          >
            {icon}
          </div>
        )}
        <div
          style={{
            fontSize: '14px',
            fontWeight: 500,
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}
        >
          {title}
        </div>
      </div>
      {preview && (
        <div
          style={{
            fontSize: '12px',
            color: 'var(--text-secondary)',
            lineHeight: '1.4',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            marginTop: '4px',
          }}
        >
          {preview}
        </div>
      )}
    </div>
  );
};
