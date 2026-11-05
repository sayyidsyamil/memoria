import type React from 'react';
import { AbsoluteFill } from 'remotion';
import '../styles.css';
import { requireBrandAssets } from '../lib/brand';

interface StageProps {
  children: React.ReactNode;
  theme?: 'light' | 'dark';
  background?: string;
}

/**
 * Stage - Brand-aware foundation for all clips
 * - Applies brand background and theme
 * - Loads brand fonts and CSS variables when available
 * - Safe framing with brand-compliant padding
 * 
 * To use real brand assets (fonts, logo, annotations):
 * 1. Run `pnpm --dir videos brand:sync` to fetch from refactoringhq/brand
 * 2. Brand assets will be gitignored (private repo)
 * 3. Clips will automatically pick them up
 */
export const Stage: React.FC<StageProps> = ({
  children,
  theme = 'dark',
  background = '#09090B',
}) => {
  // Log reminder about brand sync (doesn't block render)
  React.useEffect(() => {
    requireBrandAssets();
  }, []);

  return (
    <AbsoluteFill
      className={theme}
      style={{
        backgroundColor: background,
        fontFamily: 'Inter, sans-serif',
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '60px',
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );
};
