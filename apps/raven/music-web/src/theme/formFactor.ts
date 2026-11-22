import { type MediaQuery, MEDIA_QUERIES, useMatchesMedia } from '@/theme/media'

/** How a screen lays itself out: the apps' phone layout, or their tablet's. */
export const FORM_FACTORS = { phone: 'phone', tablet: 'tablet' } as const

export type FormFactor = (typeof FORM_FACTORS)[keyof typeof FORM_FACTORS]

type UseLayoutUnderProps = {
  /** The media query the narrow layout holds under: `MEDIA_QUERIES.phone`. */
  query: MediaQuery
}

/**
 * The layout a width asks for, followed as the window changes: `phone` while it matches
 * `query`, `tablet` past it.
 */
export const useLayoutUnder = ({ query }: UseLayoutUnderProps): FormFactor =>
  useMatchesMedia({ query }) ? FORM_FACTORS.phone : FORM_FACTORS.tablet

/**
 * The layout the window's width asks for: `phone` under `48rem`, `tablet` from there. Most of
 * what differs between them is a media query in a stylesheet; this is for the rare place code
 * must know, where what differs is a map `as const satisfies Record<FormFactor, ...>`.
 */
export const useFormFactor = (): FormFactor => useLayoutUnder({ query: MEDIA_QUERIES.phone })
