/**
 * Brand fallback tokens
 * Used when brand assets haven't been synced yet
 * Real values will be loaded from refactoringhq/brand once synced
 */

export const BRAND_COLORS = {
  blue: '#155DFF',
  red: '#FC203A',
  yellow: '#F0B100',
  green: '#00B38B',
  purple: '#A932FF',
};

export const BRAND_FONTS = `
  /* Fallback to system fonts until brand fonts are synced */
  .brand-display {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-weight: 800;
  }

  .brand-body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-weight: 500;
  }

  .brand-hand {
    font-family: 'Comic Sans MS', cursive;
    font-weight: 400;
    letter-spacing: -0.05em;
  }
`;

export const BRAND_CSS_VARS = `
  :root {
    --rf-blue: ${BRAND_COLORS.blue};
    --rf-red: ${BRAND_COLORS.red};
    --rf-yellow: ${BRAND_COLORS.yellow};
    --rf-green: ${BRAND_COLORS.green};
    --rf-purple: ${BRAND_COLORS.purple};
  }
`;
