import { KEYS } from '@raven/core'
import { classNames, Icon } from '@raven/ui'
import {
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  useId,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import shell from '@/components/AppShell/AppShell.module.scss'
import { besideOf, centreOf, type SideAnchor } from '@/components/AppShell/anchor'
import styles from '@/components/AppShell/BrowseFan.module.scss'
import { APP_SHELL_COPY } from '@/components/AppShell/copy'
import { useIsCurrent } from '@/components/AppShell/currentPage'
import { NavTip } from '@/components/AppShell/NavTip'
import { BLIPS, playBlip } from '@/lib/blip'
import { useIsDebugMode } from '@/lib/debugMode'
import { asksForLessMotion } from '@/lib/motion'
import type { TabTarget } from '@/components/TabStrip/TabStrip'

/** How far round the fan reaches: a half turn, from straight up to straight down. */
const FAN_SWEEP = 180

/** The keys that step through the open fan, and how far each one steps. */
const FAN_STEPS: Readonly<Record<string, number>> = {
  [KEYS.arrowDown]: 1,
  [KEYS.arrowRight]: 1,
  [KEYS.arrowUp]: -1,
  [KEYS.arrowLeft]: -1,
}

type AngleOfProps = { index: number; count: number }

/** Where a place sits on the half turn, in degrees from straight right: the first up, the last down. */
const angleOf = ({ index, count }: AngleOfProps): number =>
  count < 2 ? 0 : (index * FAN_SWEEP) / (count - 1) - FAN_SWEEP / 2

/** An inline style that also sets custom properties, which the fan's stylesheet reads. */
type FanStyle = CSSProperties & Record<`--${string}`, string>

type FanLinkProps = { place: TabTarget; angle: number; index: number; onOpen: () => void }

/** One place at its angle on the half turn, `index` in the fan's order, named in a tooltip. */
const FanLink = ({ place, angle, index, onOpen }: FanLinkProps) => {
  const isCurrent = useIsCurrent(place.patterns)
  const style: FanStyle = { '--angle': `${angle}deg`, '--index': `${index}` }
  return (
    <li className={styles.spoke} style={style}>
      <NavTip text={place.label} isOn>
        {(handlers) => (
          <Link
            to={place.to}
            className={styles.place}
            aria-current={isCurrent ? 'page' : undefined}
            onClick={onOpen}
            {...handlers}
          >
            <Icon name={place.icon} />
            <span className="visually-hidden">{place.label}</span>
          </Link>
        )}
      </NavTip>
    </li>
  )
}

/** The fan while it shows: where its hub is, where its glow spreads from, and whether it is on its way out. */
type Fan = { hub: SideAnchor; glow: SideAnchor; isFolding: boolean }

type BrowseFanProps = { places: readonly TabTarget[]; isIconsOnly: boolean }

/**
 * The side menu's nine-dot button, which holds the browsing places in
 * place of a row each. Pointed at, focused or pressed, it fans them out over
 * a half turn to its right, the first straight up and the last straight
 * down, over a glow that spreads from the button; they swing back and fold
 * away once the pointer or focus leaves both, and the fan is gone when that
 * motion ends, or at once for a viewer who asks for less motion. A blip
 * rises as it opens and falls as it folds. The fan renders into the body,
 * since the side menu scrolls and so clips anything inside it, yet React
 * still reads it as the wrapper's child, so moving from the button to a
 * place is no leave. The arrow keys step through the places and Escape hands
 * focus back. The button is marked while one of its places is the page open.
 */
export const BrowseFan = ({ places, isIconsOnly }: BrowseFanProps) => {
  const fanId = useId()
  const button = useRef<HTMLButtonElement>(null)
  const dots = useRef<HTMLSpanElement>(null)
  const fan = useRef<HTMLUListElement>(null)
  const [shown, setShown] = useState<Fan | null>(null)
  const isOpen = !!shown && !shown.isFolding
  const isCurrent = useIsCurrent(places.flatMap((place) => place.patterns))
  const isDebug = useIsDebugMode()

  const open = () => {
    if (isOpen || !button.current || !dots.current) return
    setShown({
      hub: besideOf({ element: button.current }),
      glow: centreOf({ element: dots.current }),
      isFolding: false,
    })
    playBlip({ blip: BLIPS.open })
  }
  const close = () => {
    if (!shown || shown.isFolding) return
    playBlip({ blip: BLIPS.close })
    setShown(asksForLessMotion() ? null : { ...shown, isFolding: true })
  }
  // The glow's fold is the longest-lived of the fan's motions, so its end is the fan's.
  const removeOnceFolded = () => {
    if (!!shown?.isFolding) setShown(null)
  }
  // Where the nine dots sit from the hub, which every place sets out from and folds back to.
  const count: FanStyle = { '--fan-count': `${places.length}` }
  const fanStyle = ({ hub, glow }: Fan): FanStyle => ({
    ...hub,
    ...count,
    '--from-x': `${glow.left - hub.left}px`,
    '--from-y': `${glow.top - hub.top}px`,
  })
  const links = (): HTMLAnchorElement[] => [...(fan.current?.querySelectorAll('a') ?? [])]

  const isWithin = (target: EventTarget | null): boolean =>
    target instanceof Node &&
    (!!button.current?.contains(target) || !!fan.current?.contains(target))
  // Focus handed back from a place, as Escape does, is no call to open again.
  const openUnlessWithin = ({ relatedTarget }: FocusEvent) => {
    if (!isWithin(relatedTarget)) open()
  }
  const closeUnlessWithin = ({ relatedTarget }: FocusEvent) => {
    if (!isWithin(relatedTarget)) close()
  }

  const step = (event: KeyboardEvent) => {
    if (event.key === KEYS.escape) {
      close()
      button.current?.focus()
      return
    }
    const by = FAN_STEPS[event.key]
    if (by === undefined || !isOpen) return
    event.preventDefault()
    const all = links()
    const at = all.findIndex((link) => link === document.activeElement)
    const next = at < 0 ? 0 : (at + by + all.length) % all.length
    all[next]?.focus()
  }

  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- it only hears the button and the fan, which are the controls; one wrapper sees a move between them as no leave
    <span
      className={styles.fan}
      onPointerEnter={open}
      onPointerLeave={close}
      onFocus={openUnlessWithin}
      onBlur={closeUnlessWithin}
      onKeyDown={step}
    >
      <button
        ref={button}
        type="button"
        className={classNames([shell.navLink, styles.trigger, isCurrent && styles.current])}
        aria-haspopup="true"
        aria-expanded={isOpen}
        aria-controls={fanId}
        onClick={isOpen ? close : open}
      >
        <span ref={dots} className={styles.dots}>
          <Icon name="apps" />
        </span>
        <span className={isIconsOnly ? 'visually-hidden' : shell.label}>
          {APP_SHELL_COPY.browse}
        </span>
      </button>
      {!!shown &&
        createPortal(
          <>
            <span
              className={classNames([
                styles.glow,
                isDebug && styles.debug,
                shown.isFolding && styles.folding,
              ])}
              style={{ ...shown.glow, ...count }}
              aria-hidden
              onAnimationEnd={removeOnceFolded}
            />
            <ul
              ref={fan}
              id={fanId}
              className={classNames([styles.places, shown.isFolding && styles.folding])}
              style={fanStyle(shown)}
              aria-label={APP_SHELL_COPY.browse}
            >
              {places.map((place, index) => (
                <FanLink
                  key={place.to}
                  place={place}
                  angle={angleOf({ index, count: places.length })}
                  index={index}
                  onOpen={close}
                />
              ))}
            </ul>
          </>,
          document.body,
        )}
    </span>
  )
}
