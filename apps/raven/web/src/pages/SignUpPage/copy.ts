export const SIGN_UP_COPY = {
  failed: 'Sign up failed. Try again.',
  title: 'Create your account',
  lead: (host: string) => `Sign up to watch on ${host}`,
  approval:
    'We will email you a link to confirm your address. The owner of this raven approves each new account by hand, so you can start watching once they have.',
  password: 'Password',
  creating: 'Creating account…',
  create: 'Create account',
  haveAccount: 'Already have an account?',
} as const
