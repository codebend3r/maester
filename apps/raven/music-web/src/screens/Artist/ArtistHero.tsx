import { DETAIL_COPY } from '@raven/wren'
import type { ReactNode } from 'react'
import type { Cover } from '@/music/useCovers'
import { BackButton } from '@/screens/detail/BackButton'
import { COLORS } from '@/theme/tokens'
import { IconButton } from '@/ui/IconButton/IconButton'
import { usePicture } from '@/ui/usePicture'
import { ICONS } from '@/ui/WrenIcon/icons'
import styles from '@/screens/Artist/ArtistHero.module.scss'

// What sits on the picture is drawn the same in both themes: light icons on a dark veil.
const ON_PICTURE = { veil: COLORS.pictureVeil, ink: COLORS.pictureInk } as const

type ArtistHeroProps = {
  name: string
  /** "8 albums · 132 songs". */
  meta: string
  /** The artist's photo, or null for the fallback: a shape holding their initial. */
  photo: Cover | null
  onMore: () => void
  /** What sits at the foot's end: `HeroActions` on the wide layout, nothing on the narrow one. */
  actions: ReactNode
}

type HeroActionsProps = { children: ReactNode }

/** Play, Shuffle and Follow at the hero's foot, as the wide layout holds them. */
export function HeroActions({ children }: HeroActionsProps) {
  return <div className={styles.actions}>{children}</div>
}

/**
 * An artist's page's head, full bleed: their photo, or a shape with their initial, fading to the
 * ground, back and More on dark circles over it, and their name in Young Serif with their counts.
 */
export function ArtistHero({ name, meta, photo, onMore, actions }: ArtistHeroProps) {
  const { src, onError } = usePicture({ picture: photo })
  return (
    <header className={styles.hero}>
      {src === null && (
        <span aria-hidden="true" className={styles.shape}>
          {name.slice(0, 1).toUpperCase()}
        </span>
      )}
      {src !== null && (
        <img alt="" className={styles.photo} decoding="async" onError={onError} src={src} />
      )}
      <span className={styles.fade} />
      <nav className={styles.bar}>
        <BackButton onPicture={ON_PICTURE} />
        <IconButton
          color={ON_PICTURE.ink}
          fill={ON_PICTURE.veil}
          icon={ICONS.more}
          label={DETAIL_COPY.more}
          onPress={onMore}
        />
      </nav>
      <div className={styles.foot}>
        <div className={styles.names}>
          <h1 className={styles.name}>{name}</h1>
          {meta !== '' && <p className={styles.meta}>{meta}</p>}
        </div>
        {actions}
      </div>
    </header>
  )
}
