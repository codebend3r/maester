import { themeOf } from '@raven/core'
import { ButtonLink } from '@raven/ui'
import { BackButton, HOME } from '@/components/BackButton/BackButton'
import { useTheme } from '@/stores/theme'
import { NOT_FOUND_COPY } from '@/pages/NotFoundPage/copy'
import styles from '@/pages/NotFoundPage/NotFoundPage.module.scss'

/** The mark drawn for each ground, as the side menu's logo picks it. */
const MARKS = {
  dark: '/brand/raven-mark-on-dark.svg',
  light: '/brand/raven-mark-on-light.svg',
} as const

const LIBRARIES_PATH = '/libraries'

/**
 * What an address that names nothing shows: a 4, an empty poster holding
 * the mark, and a 4, then the way back to the libraries or home. The three
 * figures are decoration; the heading says what happened.
 */
export const NotFoundPage = () => {
  const tone = useTheme((state) => themeOf(state.theme).tone)
  return (
    <section className={styles.page}>
      <BackButton fallback={HOME} className={styles.back} />
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
          <ButtonLink to={LIBRARIES_PATH} tone="primary" size="large">
            {NOT_FOUND_COPY.backToLibraries}
          </ButtonLink>
          <ButtonLink to={HOME.to} size="large">
            {NOT_FOUND_COPY.goHome}
          </ButtonLink>
        </nav>
      </div>
    </section>
  )
}
