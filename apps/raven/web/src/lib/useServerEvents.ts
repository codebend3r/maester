import { serverEventsFor } from '@raven/ui/headless'
import { api } from '@/lib/api'
import { onAccessTokenChange } from '@/stores/authSession'

export const { useServerEvents } = serverEventsFor({
  api,
  openEvents: (url) => new EventSource(url),
  onAccessTokenChange,
})
