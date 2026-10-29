import type { Marker } from '@raven/core'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { usePlayerPrefs } from '@/stores/playerPrefs'

/** How long Skip intro keeps the controls up once the intro starts; after that it shows with them. */
const SKIP_PROMPT_SECONDS = 8

/** How long Undo stays after an intro skipped by itself. */
const UNDO_SKIP_MS = 6_000

/** The intro's last second offers no skip: it is nearly over. */
const END_MARGIN_S = 1

type SkipItselfProps = { at: number; end: number }

type UseSkipIntroProps = {
  time: number
  intro: Marker | null
  seek: (time: number) => void
}

/**
 * Skip intro while playback is inside the file's intro: `skip` seeks to its
 * end. With `autoSkipIntro` on, the first time playback enters the intro it
 * skips by itself, once per title, and `undo` goes back to where it was for
 * a few seconds after. `isPrompting` holds the controls up for the intro's
 * first seconds and while Undo shows, so the offer is seen.
 */
export const useSkipIntro = ({ time, intro, seek }: UseSkipIntroProps) => {
  const shouldAutoSkip = usePlayerPrefs((prefs) => prefs.autoSkipIntro)
  const hasSkippedItself = useRef(false)
  const [undoTo, setUndoTo] = useState<number | null>(null)
  const isInside = intro != null && time >= intro.start && time < intro.end - END_MARGIN_S

  const skipItself = useEffectEvent(({ at, end }: SkipItselfProps) => {
    hasSkippedItself.current = true
    setUndoTo(at)
    seek(end)
  })
  useEffect(() => {
    if (!isInside || !shouldAutoSkip || hasSkippedItself.current || intro == null) return
    skipItself({ at: time, end: intro.end })
  }, [isInside, shouldAutoSkip, intro, time])

  const isUndoShown = undoTo != null
  useEffect(() => {
    if (!isUndoShown) return
    const timer = window.setTimeout(() => setUndoTo(null), UNDO_SKIP_MS)
    return () => window.clearTimeout(timer)
  }, [isUndoShown])

  return {
    isInside,
    isPrompting:
      isUndoShown || (isInside && intro != null && time < intro.start + SKIP_PROMPT_SECONDS),
    skip: () => {
      if (intro != null) seek(intro.end)
    },
    /** Back to where the intro was skipped from; null unless it skipped by itself a moment ago. */
    undo:
      undoTo == null
        ? null
        : () => {
            setUndoTo(null)
            seek(undoTo)
          },
  }
}
