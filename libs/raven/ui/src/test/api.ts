import { createApiClient } from '@raven/core'

export const api = createApiClient({ fetch: (url, init) => window.fetch(url, init) })
