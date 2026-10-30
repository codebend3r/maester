export const ACCOUNT_MENU_COPY = {
  owner: 'Owner',
  member: 'Member',
  signOutFailed: (message: string) => `Could not sign out: ${message}`,
} as const
