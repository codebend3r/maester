/** The raven the sandbox searches, by its host; null for the case's fake. */
type EnvironmentProps = { host: string | null }

export const SIDEBAR_COPY = {
  label: 'Controls',
  wordmark: 'sparrow',
  case: 'Case',
  tier: 'Tier',
  caseMessages: 'Case messages',
  sandbox: '● Sandbox',
  environment: ({ host }: EnvironmentProps) => `raven · ${host ?? "the case's fake"}`,
  startOver: 'Start over',
  failed: "The sandbox didn't take that; is it still running?",
} as const
