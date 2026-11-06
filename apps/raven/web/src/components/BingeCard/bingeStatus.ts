import { BINGE_STATUS_KINDS, type BingeStatus } from '@raven/core'
import { BINGE_CARD_COPY } from '@/components/BingeCard/copy'
import { timeLeft } from '@/pages/HomePage/ContinueWatching'

/** The words at a Binge card's foot: "23m left" once started, else "Start season 1 episode 2". */
export const bingeStatusWords = (status: BingeStatus | null): string | null => {
  if (status === null) return null
  switch (status.kind) {
    case BINGE_STATUS_KINDS.left:
      return timeLeft(status.media)
    case BINGE_STATUS_KINDS.start:
      return BINGE_CARD_COPY.start({ season: status.season, episode: status.episode })
    default: {
      const unreachable: never = status
      return unreachable
    }
  }
}
