import { Logo } from '@/components/Logo/Logo'
import { GET_COPY } from '@/pages/GetPage/copy'
import styles from '@/pages/GetPage/AppPreview.module.scss'

/** The side menu's rows, as wide as their names would be; the first is the page it is on. */
const ROWS = ['70%', '55%', '62%', '48%', '58%', '40%'] as const

/** A shelf of posters, each its own colour. */
const SHELF = [60, 220, 230, 30, 200, 140, 10] as const

const tint = (hue: number) => (node: HTMLSpanElement | null) =>
  node?.style.setProperty('--hue', String(hue))

const widen = (width: string) => (node: HTMLSpanElement | null) =>
  node?.style.setProperty('--width', width)

/**
 * raven in miniature, in a desktop window cut off at the foot: the side
 * menu, the search and theme button along the top, a featured film, then a
 * shelf of posters. Placeholder art in the theme's own colours, all of it
 * decoration.
 */
export const AppPreview = () => (
  <div className={styles.window} aria-hidden="true">
    <span className={styles.bar}>
      <span className={`${styles.light} ${styles.close}`} />
      <span className={`${styles.light} ${styles.minimise}`} />
      <span className={`${styles.light} ${styles.zoom}`} />
    </span>
    <span className={styles.body}>
      <span className={styles.rail}>
        <span className={styles.mark}>
          <Logo isMarkOnly />
        </span>
        {ROWS.map((width, index) => (
          <span
            key={width}
            ref={widen(width)}
            className={index === 0 ? `${styles.row} ${styles.current}` : styles.row}
          />
        ))}
      </span>
      <span className={styles.stage}>
        <span className={styles.top}>
          <span className={styles.search} />
          <span className={styles.swatch} />
        </span>
        <span className={styles.feature}>
          <span className={styles.featureTitle}>{GET_COPY.previewFeature}</span>
          <span className={styles.play} />
        </span>
        <span className={styles.shelfHead} />
        <span className={styles.shelf}>
          {SHELF.map((hue) => (
            <span key={hue} ref={tint(hue)} className={styles.poster} />
          ))}
        </span>
      </span>
    </span>
  </div>
)
