export const MATCH_TIER_COPY = {
  strong: 'Strong match',
  possible: 'Possible match',
  weak: 'Weak match',
  best: 'Best match',
  confidence: (confidence: number) => `, confidence ${confidence} out of 100`,
} as const
