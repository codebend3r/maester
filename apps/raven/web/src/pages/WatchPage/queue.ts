import { type QueueStop, episodePlace, mediaLabel } from '@raven/core'
import type { QueueEntry } from '@raven/ui/headless'

type QueueEntryOfProps = { stop: QueueStop; at: number }

/** A stop as the Queue menu lists it. */
export const queueEntryOf = ({ stop, at }: QueueEntryOfProps): QueueEntry => ({
  // A shuffle may deal one video twice, so its place is part of its key.
  key: `${at}:${stop.media.id}`,
  to: stop.link.to,
  state: stop.link.state,
  label: mediaLabel(stop.media),
  detail: episodePlace(stop.media),
  isCurrent: stop.isCurrent,
})
