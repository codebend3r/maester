import { type PointerEvent, createContext, useContext, useEffect, useRef } from 'react'
import { usePageBackdrop } from '@/stores/pageBackdrop'

/**
 * Whether the cards inside bring their pictures in behind the page. A page
 * with a backdrop of its own, as a saga's has, provides false, so pointing
 * at a card leaves that backdrop alone.
 */
export const HoverBackdrops = createContext(true)

/** How long the pointer rests on a card before its picture comes in, so a sweep across the grid loads none. */
const REST_MS = 120

/**
 * How long a picture outlives the pointer leaving its card: long enough for
 * the next card's picture to take over, so moving between cards crosses from
 * one to the next instead of fading to nothing between them.
 */
const LINGER_MS = 300

/**
 * Handlers for a card that shows `url` behind the whole page while it is
 * pointed at or focused, and puts it away after. Touch has no pointing, so a
 * tap only opens the card. With no picture, or inside a page that keeps
 * `HoverBackdrops` off, the card gets no handlers.
 */
export const useHoverBackdrop = (url: string | null) => {
  const isOn = useContext(HoverBackdrops)
  const show = usePageBackdrop((state) => state.show)
  const hide = usePageBackdrop((state) => state.hide)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  const after = ({ ms, run }: { ms: number; run: () => void }) => {
    cancel()
    timer.current = setTimeout(run, ms)
  }

  // A card that goes while pointed at, as a click opens its page, takes its picture with it.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
      if (url) hide(url)
    },
    [url, hide],
  )

  if (!url || !isOn) return {}
  // `hide` only puts away the picture still shown, so a card entered since keeps its own.
  const linger = () => after({ ms: LINGER_MS, run: () => hide(url) })
  return {
    onPointerEnter: (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return
      after({ ms: REST_MS, run: () => show(url) })
    },
    onPointerLeave: linger,
    onFocus: () => {
      cancel()
      show(url)
    },
    onBlur: linger,
  }
}
