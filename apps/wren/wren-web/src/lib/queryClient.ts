import { createQueryClient } from '@raven/ui/headless'

/** The tab's one cache, which signing out or switching accounts empties from outside React. */
export const queryClient = createQueryClient()
