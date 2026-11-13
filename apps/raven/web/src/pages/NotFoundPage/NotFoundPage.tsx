import { themeOf } from '@raven/core'
import { BUTTON_TONES, ButtonLink } from '@raven/ui'
import { BackButton } from '@/components/BackButton/BackButton'
import { useMusicLinks } from '@/lib/useMusicLinks'
import { useTheme } from '@/stores/theme'
import { NOT_FOUND_COPY } from '@/pages/NotFoundPage/copy'
import styles from '@/pages/NotFoundPage/NotFoundPage.module.scss'
import { APP_PATHS } from '@/lib/appPaths'

/** The mark drawn for each ground, as the side menu's logo picks it. */
const MARKS = {
  dark: '/brand/raven-mark-on-dark.svg',
  light: '/brand/raven-mark-on-light.svg',
} as const

/**
 * What an address that names nothing shows: a 4, an empty poster holding
 * the mark, and a 4, then the way back to the libraries or home, the
 * music mode's own Home inside it. The three
 * figures are decoration; the heading says what happened.
 */
export const NotFoundPage = () => {
  const tone = useTheme((state) => themeOf(state.theme).tone)
  const { home } = useMusicLinks()
  return (
    <section className={styles.page}>
      <BackButton fallback={home} className={styles.back} />
      <div className={styles.body}>
        <p className={styles.figures} aria-hidden="true">
          <span>{NOT_FOUND_COPY.figure}</span>
          <span className={styles.poster}>
            <img src={MARKS[tone]} alt="" width={646} height={705} className={styles.mark} />
          </span>
          <span>{NOT_FOUND_COPY.figure}</span>
        </p>
        <h1 className={styles.title}>{NOT_FOUND_COPY.title}</h1>
        <p className={styles.copy}>{NOT_FOUND_COPY.body}</p>
        <nav className={styles.actions} aria-label={NOT_FOUND_COPY.waysBack}>
          <ButtonLink to={APP_PATHS.libraries} tone={BUTTON_TONES.primary} size="large">
            {NOT_FOUND_COPY.backToLibraries}
          </ButtonLink>
          <ButtonLink to={home.to} size="large">
            {NOT_FOUND_COPY.goHome}
          </ButtonLink>
        </nav>
      </div>
    </section>
  )
}
