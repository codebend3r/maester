import { useCallback, useSyncExternalStore } from 'react'

/** How a screen lays itself out: the apps' phone layout, or their tablet's. */
export const FORM_FACTORS = { phone: 'phone', tablet: 'tablet' } as const

export type FormFactor = (typeof FORM_FACTORS)[keyof typeof FORM_FACTORS]

/** The narrow layout, the apps' phone's, holds up to this width; the stylesheets' `48rem` too. */
const PHONE_QUERY = '(max-width: 48rem)'

const MEDIA_EVENTS = { change: 'change' } as const

type UseLayoutUnderProps = {
  /** The media query the narrow layout holds under: `(max-width: 48rem)`. */
  query: string
}

/**
 * The layout a width asks for, followed as the window changes: `phone` while it matches
 * `query`, `tablet` past it.
 */
export const useLayoutUnder = ({ query }: UseLayoutUnderProps): FormFactor => {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const media = window.matchMedia(query)
      media.addEventListener(MEDIA_EVENTS.change, onChange)
      return () => media.removeEventListener(MEDIA_EVENTS.change, onChange)
    },
    [query],
  )
  const isNarrow = useSyncExternalStore(subscribe, () => window.matchMedia(query).matches)
  return isNarrow ? FORM_FACTORS.phone : FORM_FACTORS.tablet
}

/**
 * The layout the window's width asks for: `phone` under `48rem`, `tablet` from there. Most of
 * what differs between them is a media query in a stylesheet; this is for the rare place code
 * must know, where what differs is a map `as const satisfies Record<FormFactor, ...>`.
 */
export const useFormFactor = (): FormFactor => useLayoutUnder({ query: PHONE_QUERY })
