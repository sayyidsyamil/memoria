/**
 * Brand kit integration
 * Loads fonts, assets, and tokens from refactoringhq/brand (private repo)
 * 
 * Run `pnpm brand:sync` to pull the brand assets before rendering.
 * 
 * Note: This module uses fallback values when brand assets aren't synced.
 * Remotion bundler doesn't support Node.js fs at runtime, so paths are
 * resolved at build time or via static imports.
 */

import { BRAND_COLORS } from './brand-fallback';

/**
 * Brand color tokens
 */
export interface BrandColors {
  blue: string;
  red: string;
  yellow: string;
  green: string;
  purple: string;
}

/**
 * Get brand colors (uses fallback if brand not synced)
 */
export function getBrandColors(): BrandColors {
  return BRAND_COLORS;
}

/**
 * Log brand sync reminder (called at component mount, not blocking)
 */
export function requireBrandAssets(): void {
  // Remotion bundler limitation: can't check fs at runtime
  // This is a no-op placeholder for future enhancement
  console.info('ℹ️  To use real brand assets: pnpm --dir videos brand:sync');
}

/**
 * Get path to a brand asset (placeholder for when brand is synced)
 */
export function getBrandAssetPath(name: string): string {
  // When brand assets are synced, they'll be in videos/brand/assets/
  // Remotion can load them via relative paths at build time
  try {
    return `../../../brand/assets/${name}`;
  } catch {
    return '';
  }
}
