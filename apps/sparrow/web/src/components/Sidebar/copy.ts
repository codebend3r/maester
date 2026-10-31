type EnvironmentProps = { raven: string | null }

const hostOf = (address: string): string => {
  try {
    return new URL(address).host
  } catch {
    return address
  }
}

export const SIDEBAR_COPY = {
  label: 'Controls',
  wordmark: 'sparrow',
  case: 'Case',
  tier: 'Tier',
  caseMessages: 'Case messages',
  sandbox: '● Sandbox',
  environment: ({ raven }: EnvironmentProps) =>
    `raven · ${raven === null ? "the case's fake" : hostOf(raven)}`,
  startOver: 'Start over',
  failed: "The sandbox didn't take that; is it still running?",
} as const
