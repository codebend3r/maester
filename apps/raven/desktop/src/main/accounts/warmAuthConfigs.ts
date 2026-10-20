import type { AuthConfigs } from '@/main/accounts/authConfigs'

/**
 * Reads each stored server's sign-in settings once, so a server whose accounts are ready gets its
 * Bearer from the first call after a relaunch instead of after the first sign-in or refusal.
 * It settles when every read has; one that fails is only warned, naming the server and nothing else.
 */
export const warmAuthConfigs = async ({
  servers,
  authConfigs,
  warn,
}: {
  servers: readonly { id: string }[]
  authConfigs: Pick<AuthConfigs, 'stateOf'>
  warn: (message: string) => void
}): Promise<void> => {
  await Promise.all(
    servers.map(async ({ id }) => {
      try {
        await authConfigs.stateOf(id)
      } catch {
        // Only the server id: whatever was thrown is not worth the risk of carrying a secret into the log.
        warn(`raven player could not read the sign-in settings of server ${id}.`)
      }
    }),
  )
}
