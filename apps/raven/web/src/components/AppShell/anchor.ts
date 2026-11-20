/** A point an overlay hangs from, in the window's own coordinates. */
export type SideAnchor = { top: number; left: number }

type BesideProps = { element: Element }

/** The middle of an element's right edge, where the side menu's overlays open from. */
export const besideOf = ({ element }: BesideProps): SideAnchor => {
  const rect = element.getBoundingClientRect()
  return { top: rect.top + rect.height / 2, left: rect.right }
}

type CentreProps = { element: Element }

/** The middle of an element, where a glow spreads from. */
export const centreOf = ({ element }: CentreProps): SideAnchor => {
  const rect = element.getBoundingClientRect()
  return { top: rect.top + rect.height / 2, left: rect.left + rect.width / 2 }
}
