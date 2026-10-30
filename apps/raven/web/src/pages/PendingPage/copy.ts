import { ACCESS_KINDS } from '@/lib/accessState'

export const PENDING_COPY = {
  [ACCESS_KINDS.pending]: {
    title: 'Waiting for approval',
    lead: 'The owner of this raven approves each new account by hand. You can start watching once they have.',
  },
  [ACCESS_KINDS.revoked]: {
    title: 'Your access was removed',
    lead: "The owner of this raven removed this account's access. Ask them if you think that is a mistake.",
  },
  checkFailed: 'Could not check. Try again.',
  signedInAs: 'Signed in as',
  signedInAsEnd: '.',
  checking: 'Checking',
  checkAgain: 'Check again',
} as const
