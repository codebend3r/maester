import { useSkipIntro } from '@raven/ui/headless'

import { PLAYER_COPY, type PlayerChromeProps } from '@/layouts/playerKit'

/**
 * The one button the intro offers: Skip intro while the video is inside it, or Undo skip for a
 * few seconds after it skipped by itself. `isPrompting` is true over the intro's first seconds
 * and while Undo shows, when the offer stands up on its own rather than only with the controls.
 */
export type IntroOffer = {
  label: string
  onPress: () => void
  isPrompting: boolean
}

type SkipIntro = ReturnType<typeof useSkipIntro>

/** Undo first, since it follows a skip out of the intro; then Skip intro while inside it; else nothing. */
export const introOfferOf = ({
  isInside,
  isPrompting,
  skip,
  undo,
}: SkipIntro): IntroOffer | null => {
  if (undo !== null) return { label: PLAYER_COPY.undoSkip, onPress: undo, isPrompting }
  if (!isInside) return null
  return { label: PLAYER_COPY.skipIntro, onPress: skip, isPrompting }
}

type UseIntroOfferProps = Pick<PlayerChromeProps, 'intro' | 'transport'>

/**
 * The web player's Skip intro, for raven's own controls: the same hook, so autoplay's
 * `autoSkipIntro` skips by itself here too. Until there is a video to drive there is no intro to
 * be inside, so nothing skips into a player that cannot seek yet.
 */
export const useIntroOffer = ({ intro, transport }: UseIntroOfferProps): IntroOffer | null =>
  introOfferOf(
    useSkipIntro({
      time: transport?.position ?? 0,
      intro: transport === null ? null : intro,
      seek: (time) => transport?.onSeek(time),
    }),
  )
