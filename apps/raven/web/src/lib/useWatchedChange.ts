import { watchedChangeFor } from '@raven/ui/headless'
import { api } from '@/lib/api'

export const { useWatchedChange, useWatchedToggle } = watchedChangeFor({ api })
