export const HERO_TOGGLE_COPY = {
  heroFull: (limit: number) => `The hero holds at most ${limit} titles; take one out first`,
  takeOut: "Take this title out of Home's hero",
  putIn: "Show this title in Home's hero",
  inHero: 'In hero',
  addToHero: 'Add to hero',
} as const
