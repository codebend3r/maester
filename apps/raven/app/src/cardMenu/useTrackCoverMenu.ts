import type { Track } from '@raven/core'

import type { TouchCard } from '@/cardMenu/touchCard'
import { useTouchCard } from '@/cardMenu/useTouchCard'
import { CARD_SUBJECTS } from '@/queries/cards'

type UseTrackCoverMenuProps = { track: Track | null }

/** The playing track's cover under the thumb: a long press opens the track's menu; none while nothing plays. */
export const useTrackCoverMenu = ({ track }: UseTrackCoverMenuProps): TouchCard =>
  useTouchCard({
    card: {
      title: track?.title ?? '',
      subject: track === null ? null : { kind: CARD_SUBJECTS.track, track },
    },
  })
