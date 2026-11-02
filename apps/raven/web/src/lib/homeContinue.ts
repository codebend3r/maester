/** The page that lists every video in progress, which home's Continue watching links to. */
export const CONTINUE_WATCHING_PATH = '/continue-watching'

/** Tiles the home page shows when the build names no count: three rows of two. */
const DEFAULT_COUNT = 6

type HomeContinueCountProps = { given: string | undefined }

/** How many Continue watching tiles home shows from `RAVEN_HOME_CONTINUE_COUNT`; the default for none or a bad one. */
export const homeContinueCountOf = ({ given }: HomeContinueCountProps): number => {
  const count = Number(given)
  return given !== undefined && Number.isInteger(count) && count >= 1 ? count : DEFAULT_COUNT
}

export const HOME_CONTINUE_COUNT = homeContinueCountOf({
  given: import.meta.env.VITE_HOME_CONTINUE_COUNT,
})
