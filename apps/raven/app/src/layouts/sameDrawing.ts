/** The field every React element carries, and plain data never does. */
const REACT_ELEMENT = '$$typeof'

type IsSameValueProps = { was: unknown; now: unknown }

/** Whether two prop values draw the same: the same value, two callbacks, or data alike in every field. */
const isSameValue = ({ was, now }: IsSameValueProps): boolean => {
  if (Object.is(was, now)) return true
  if (typeof was === 'function' && typeof now === 'function') return true
  if (typeof was !== 'object' || typeof now !== 'object' || was === null || now === null) {
    return false
  }
  // An element holds its owner, which leads back round to itself: drawn again whenever it is new.
  if (REACT_ELEMENT in was || REACT_ELEMENT in now) return false
  return JSON.stringify(was) === JSON.stringify(now)
}

/**
 * `memo`'s comparison for a TV part whose props are data and callbacks: it draws again only when
 * some data changed. Home's cards, shelves and hero are handed fresh objects each time a query
 * lands or a scroll window grows, and the inline callbacks that go with them do the same thing
 * every time, so comparing them by identity drew every card on the screen again while the
 * remote waited. A callback kept from an earlier drawing is one its data, unchanged, would make.
 */
export const isSameDrawing = <Props extends object>(was: Props, now: Props): boolean => {
  const keys = new Set([...Object.keys(was), ...Object.keys(now)])
  return [...keys].every((key) =>
    isSameValue({ was: Reflect.get(was, key), now: Reflect.get(now, key) }),
  )
}
