import { AUTH_SCREEN_COPY } from '@/components/AuthScreen/copy'
import styles from '@/components/AuthScreen/AuthScreen.module.scss'

type Tile = { hue: number; lightness: number; opacity: number }

// Eight rows of six, so the wall still covers a tall panel once it is tilted.
// 47 and 360 share no factor, so every tile's hue is its own.
const TILES: readonly Tile[] = Array.from({ length: 48 }, (_, index) => ({
  hue: (index * 47) % 360,
  lightness: 0.55 + (index % 3) * 0.05,
  opacity: 0.55 + ((index * 7) % 5) * 0.08,
}))

const paint =
  ({ hue, lightness, opacity }: Tile) =>
  (node: HTMLSpanElement | null) => {
    node?.style.setProperty('--hue', String(hue))
    node?.style.setProperty('--lightness', String(lightness))
    node?.style.setProperty('--opacity', String(opacity))
  }

/**
 * The art beside the sign-in form: a tilted wall of poster-shaped tiles in a
 * spread of colours, standing in for a library, fading into the page at its
 * right, with raven's promise set over its foot.
 */
export const PosterWall = () => (
  <div className={styles.art} aria-hidden="true">
    <div className={styles.wall}>
      {TILES.map((tile) => (
        <span key={tile.hue} ref={paint(tile)} className={styles.tile} />
      ))}
    </div>
    <p className={styles.promise}>{AUTH_SCREEN_COPY.promise}</p>
  </div>
)
