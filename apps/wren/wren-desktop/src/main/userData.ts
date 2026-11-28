/** The environment variable an unpackaged run names a throwaway profile in, for the end to end suite. */
export const USER_DATA_ENV = 'WREN_DESKTOP_USER_DATA'

type UserDataFromProps = {
  isPackaged: boolean
  env: Readonly<Record<string, string | undefined>>
}

/**
 * The folder an unpackaged run keeps its data in instead of Electron's own, or null to leave
 * that as it is. A test hook: a packaged app never reads it, so the environment cannot move
 * Wren's sign-in, its settings or where its window was.
 */
export const userDataFrom = ({ isPackaged, env }: UserDataFromProps): string | null => {
  const hook = isPackaged ? '' : (env[USER_DATA_ENV] ?? '')
  return hook === '' ? null : hook
}
