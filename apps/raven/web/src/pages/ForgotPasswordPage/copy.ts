export const FORGOT_PASSWORD_COPY = {
  sent: 'If that address has an account, a link is on its way.',
  sending: 'Sending…',
  sendAgainIn: (seconds: number) => `Send again in ${seconds}s`,
  sendLink: 'Send reset link',
  title: 'Reset your password',
  lead: 'Enter the email you signed up with and we will send you a link to choose a new password.',
} as const
