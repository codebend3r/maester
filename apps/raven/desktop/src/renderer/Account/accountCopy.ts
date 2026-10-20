/** What every account screen says of a server whose account it cannot show. */
export const ACCOUNT_COPY = {
  unavailable: (name: string) => `Accounts are unavailable on ${name} right now.`,
  failed: (name: string) => `raven player could not check your account on ${name}.`,
} as const
