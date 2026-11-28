import {
  MUSIC_FACT_LABELS,
  MUSIC_LINKS,
  type MusicFact,
  type MusicLink,
  musicLinkKeyOf,
  musicLinkLabelOf,
} from '@raven/core'
import { BUTTON_TONES, Button, Icon, type IconName } from '@raven/ui'
import { useEffect, useId } from 'react'
import { Link } from 'react-router-dom'
import { DIALOG_WIDTHS, DialogFrame } from '@/components/DialogFrame/DialogFrame'
import { MUSIC_MENU_COPY } from '@/components/MusicMenu/copy'
import styles from '@/components/MusicMenu/MusicMenu.module.scss'
import { COMMON_COPY } from '@/lib/copy'
import { useModal } from '@/lib/useModal'
import { useMusicLinks } from '@/lib/useMusicLinks'

const LINK_ICONS = {
  [MUSIC_LINKS.album]: 'disc',
  [MUSIC_LINKS.artist]: 'music',
} as const satisfies Record<MusicLink['kind'], IconName>

/** An album's heart in its menu: whether it is a favourite now, and the press that turns it. */
type MenuFavourite = {
  isOn: boolean
  onToggle: (favourite: boolean) => void
}

/** The event a press on the backdrop arrives as. */
const BACKDROP_EVENTS = { press: 'pointerdown' } as const

type MusicMenuProps = {
  /** The album's or the track's title, over the facts. */
  title: string
  facts: readonly MusicFact[]
  links: readonly MusicLink[]
  /** An album's Add to or Remove from favourites, above the links; null for a track, and until the album is read. */
  favourite: MenuFavourite | null
  /** Heard on every way out: the X, Escape, a press outside it, or a link taken. */
  onClose: () => void
}

/**
 * The menu a long press on a cover opens: the album's or the playing track's title, what is
 * known of it, an album's Add to or Remove from favourites, then Go to album and Go to artist.
 * A modal dialog, so it rises over the mini player and whatever the cover sits in; on a narrow
 * screen it sits at the foot, under the thumb.
 */
export const MusicMenu = ({ title, facts, links, favourite, onClose }: MusicMenuProps) => {
  const titleId = useId()
  const { dialog, close, keepKeys } = useModal()
  const paths = useMusicLinks()

  // A fresh press on the backdrop closes it; the finger lifting off the cover sends no press.
  useEffect(() => {
    const frame = dialog.current
    if (frame === null) return undefined
    const onPointerDown = (event: PointerEvent) => {
      if (event.target === frame) frame.close()
    }
    frame.addEventListener(BACKDROP_EVENTS.press, onPointerDown)
    return () => frame.removeEventListener(BACKDROP_EVENTS.press, onPointerDown)
  }, [dialog])

  return (
    <DialogFrame
      dialog={dialog}
      width={DIALOG_WIDTHS.narrow}
      className={styles.sheet}
      labelledBy={titleId}
      onClose={onClose}
      onKeyDown={keepKeys}
    >
      <div className={styles.body}>
        <header className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          <Button
            tone={BUTTON_TONES.ghost}
            icon="close"
            className={styles.close}
            aria-label={COMMON_COPY.close}
            onClick={close}
          />
        </header>
        {facts.length > 0 && (
          <dl className={styles.facts} aria-label={MUSIC_MENU_COPY.about(title)}>
            {facts.map((fact) => (
              <div key={fact.key} className={styles.fact}>
                <dt>{MUSIC_FACT_LABELS[fact.key]}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {favourite !== null && (
          <button
            type="button"
            className={styles.link}
            aria-pressed={favourite.isOn}
            onClick={() => favourite.onToggle(!favourite.isOn)}
          >
            <Icon name="heart" size={18} />
            {favourite.isOn ? MUSIC_MENU_COPY.removeFavourite : MUSIC_MENU_COPY.addFavourite}
          </button>
        )}
        <nav aria-label={MUSIC_MENU_COPY.goTo}>
          <ul className={styles.links}>
            {links.map((link) => (
              <li key={musicLinkKeyOf(link)}>
                <Link
                  to={
                    link.kind === MUSIC_LINKS.album
                      ? paths.album(link.albumId)
                      : paths.artist(link.artistId)
                  }
                  className={styles.link}
                  onClick={close}
                >
                  <Icon name={LINK_ICONS[link.kind]} size={18} />
                  {musicLinkLabelOf(link)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </DialogFrame>
  )
}
