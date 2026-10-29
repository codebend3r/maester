/** An account a local test build opens its sign-in with. */
export type TestAccount = { email: string; password: string }

type TestAccountOfProps = { email: string | undefined; password: string | undefined }

/** The account named, or null unless both its email and its password are. */
export const testAccountOf = ({ email, password }: TestAccountOfProps): TestAccount | null =>
  email !== undefined && email !== '' && password !== undefined && password !== ''
    ? { email, password }
    : null

/**
 * The account a build made for testing on this machine opens its sign-in with: the app's
 * gitignored `.env.test-account`, which only `build:android-tv:test-account` reads (never Nx,
 * never Expo on its own, so no cached build holds it), and which Expo writes into that build's
 * bundle. Null in every other build. With one, the sign-in opens on Sign in rather than in the
 * email field, so the keyboard never opens over the filled fields: Google TV's keyboard takes a
 * field's text as the word it is editing, and can drop it as the remote leaves.
 */
export const TEST_ACCOUNT = testAccountOf({
  email: process.env.EXPO_PUBLIC_RAVEN_TEST_EMAIL,
  password: process.env.EXPO_PUBLIC_RAVEN_TEST_PASSWORD,
})
