export const CHECK_EMAIL_COPY = {
  title: 'Check your email',
  sentTo: 'We sent a link to confirm your address to',
  sentToEnd: '.',
  lookInInbox: 'Look in your inbox for the link to confirm your address.',
  approval:
    'If it has not come, look in spam. Once you confirm, the owner of this raven approves each new account by hand, so you can start watching once they have.',
  or: 'or',
  createAccount: 'Create an account',
  resend: 'Resend',
  resendIn: (seconds: number) => `Resend in ${seconds}s`,
  sent: 'Email sent.',
} as const
