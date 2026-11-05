import type React from 'react';
import { BRAND_COLORS } from '../lib/brand-fallback';

interface BrandAnnotationProps {
  text: string;
  x: number;
  y: number;
  rotate?: number;
  color?: string;
  style?: React.CSSProperties;
}

/**
 * Hand-drawn annotation using Refactoring Hand font
 * For captions, notes, and emphasis text
 */
export const BrandAnnotation: React.FC<BrandAnnotationProps> = ({
  text,
  x,
  y,
  rotate = 0,
  color = BRAND_COLORS.yellow,
  style,
}) => {
  return (
    <div
      style={{
        position: 'absolute',
        left: `${x}px`,
        top: `${y}px`,
        transform: `rotate(${rotate}deg)`,
        fontFamily: '"Refactoring Hand", "Comic Sans MS", cursive',
        fontSize: '18px',
        fontWeight: 400,
        letterSpacing: '-0.05em',
        color,
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        ...style,
      }}
    >
      {text}
    </div>
  );
};

interface BrandArrowProps {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  color?: string;
  strokeWidth?: number;
  curved?: boolean;
}

/**
 * Hand-drawn arrow (fallback: simple SVG arrow until brand assets synced)
 */
export const BrandArrow: React.FC<BrandArrowProps> = ({
  fromX,
  fromY,
  toX,
  toY,
  color = BRAND_COLORS.red,
  strokeWidth = 3,
  curved = false,
}) => {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const angle = Math.atan2(dy, dx);
  
  // Arrow head
  const headLength = 12;
  const headAngle = Math.PI / 6;
  
  const arrowHead1X = toX - headLength * Math.cos(angle - headAngle);
  const arrowHead1Y = toY - headLength * Math.sin(angle - headAngle);
  const arrowHead2X = toX - headLength * Math.cos(angle + headAngle);
  const arrowHead2Y = toY - headLength * Math.sin(angle + headAngle);

  return (
    <svg
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      }}
    >
      {curved ? (
        <path
          d={`M ${fromX} ${fromY} Q ${(fromX + toX) / 2} ${(fromY + toY) / 2 - 30} ${toX} ${toY}`}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
        />
      ) : (
        <line
          x1={fromX}
          y1={fromY}
          x2={toX}
          y2={toY}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
      )}
      {/* Arrow head */}
      <line
        x1={toX}
        y1={toY}
        x2={arrowHead1X}
        y2={arrowHead1Y}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      <line
        x1={toX}
        y1={toY}
        x2={arrowHead2X}
        y2={arrowHead2Y}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </svg>
  );
};

interface EmphasisCircleProps {
  x: number;
  y: number;
  radius: number;
  color?: string;
  strokeWidth?: number;
}

/**
 * Hand-drawn emphasis circle
 */
export const EmphasisCircle: React.FC<EmphasisCircleProps> = ({
  x,
  y,
  radius,
  color = BRAND_COLORS.red,
  strokeWidth = 3,
}) => {
  return (
    <svg
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      }}
    >
      <circle
        cx={x}
        cy={y}
        r={radius}
        stroke={color}
        strokeWidth={strokeWidth}
        fill="none"
        strokeLinecap="round"
        opacity={0.8}
      />
    </svg>
  );
};

interface BrandTitleCardProps {
  title: string;
  subtitle?: string;
  style?: React.CSSProperties;
}

/**
 * Title card with Refactoring Sans ExtraBold
 */
export const BrandTitleCard: React.FC<BrandTitleCardProps> = ({
  title,
  subtitle,
  style,
}) => {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '16px',
        ...style,
      }}
    >
      <div
        style={{
          fontFamily: '"Refactoring Sans", -apple-system, sans-serif',
          fontSize: '64px',
          fontWeight: 800,
          color: '#FFFFFF',
          textAlign: 'center',
          lineHeight: 1.1,
        }}
      >
        {title}
      </div>
      {subtitle && (
        <div
          style={{
            fontFamily: '"Inter Tight", Inter, sans-serif',
            fontSize: '24px',
            fontWeight: 500,
            color: 'rgba(255, 255, 255, 0.7)',
            textAlign: 'center',
          }}
        >
          {subtitle}
        </div>
      )}
    </div>
  );
};
