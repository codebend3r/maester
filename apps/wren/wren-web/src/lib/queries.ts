import { ravenQueriesFor } from '@raven/ui/headless'
import { api } from '@/lib/api'

/** Every question Wren asks raven, as TanStack Query options over the page's one `api`. */
export const queries = ravenQueriesFor(api)
