import type { AppPath } from '@raven/core'
import {
  type ComponentProps,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useRef,
} from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { prefetchItemHandlers } from '@/lib/prefetchItem'
import { type Follow, useCardLinks } from '@/stores/cardLinks'

type CardLinksProps = { children: ReactNode }

/**
 * Follows the card links inside, with one hold on the router for the whole
 * app. Each of react-router's `Link`s takes its own, a handful of hooks and
 * a layout effect apiece, which a grid of thousands of cards with three
 * links each paid for on every load. `follow` keeps one identity for good,
 * so no card draws again when the address changes. It goes in
 * `useCardLinks` as this mounts, and the links inside draw once it is there.
 */
export const CardLinks = ({ children }: CardLinksProps) => {
  const navigate = useNavigate()
  const location = useLocation()
  const latest = useRef({ navigate, location })
  useLayoutEffect(() => {
    latest.current = { navigate, location }
  })
  const follow = useCallback<Follow>(({ to, state }) => {
    const { pathname, search, hash } = latest.current.location
    // As `Link` does: the page already open is replaced, not stacked again.
    latest.current.navigate(to, { state, replace: to === `${pathname}${search}${hash}` })
  }, [])
  useLayoutEffect(() => {
    useCardLinks.setState({ follow })
    return () => {
      if (useCardLinks.getState().follow === follow) useCardLinks.setState({ follow: null })
    }
  }, [follow])
  const isFollowing = useCardLinks((state) => state.follow !== null)
  return isFollowing && children
}

/** A click the browser would follow in this tab: the main button, no key held to open it elsewhere. */
const isPlainClick = (event: MouseEvent): boolean =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey

type CardLinkProps = Omit<ComponentProps<'a'>, 'href' | 'target' | 'download'> & {
  to: AppPath
  state?: unknown
  /** The item whose page `to` opens, read ahead when the link is pointed at or focused. */
  prefetchItem?: number | null
}

/**
 * A link on a card, row or tile, opening `to` in the app with `state`
 * handed over, as react-router's `Link` does, for a fraction of its cost. A
 * click with a key held, or with another button, is the browser's, so the
 * address opens in a new tab or window. It takes no `target` or `download`,
 * which its click would ignore, opening the address in this tab all the
 * same. It must sit inside `CardLinks`.
 */
export const CardLink = ({
  to,
  state,
  onClick,
  prefetchItem,
  children,
  ...rest
}: CardLinkProps) => {
  const follow = useCardLinks((links) => links.follow)
  if (!follow) throw new Error('CardLink needs CardLinks around it')
  return (
    <a
      {...prefetchItemHandlers(prefetchItem)}
      {...rest}
      href={to}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented || !isPlainClick(event)) return
        event.preventDefault()
        follow({ to, state })
      }}
    >
      {children}
    </a>
  )
}
