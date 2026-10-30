type BadgeProps = { model: string; raven: string | null }

export const SANDBOX_BAR_COPY = {
  label: 'Sandbox',
  badge: ({ model, raven }: BadgeProps) => `Sandbox · ${model} · raven ${raven ?? 'fake'}`,
  case: 'Case',
  tier: 'Tier',
  startOver: 'Start over',
  failed: "The sandbox didn't take that; is it still running?",
} as const
