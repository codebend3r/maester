import { ButtonLink, themeOf } from '@raven/ui'
import { BackButton } from '@/components/BackButton/BackButton'
import { useTheme } from '@/stores/theme'
import styles from '@/pages/NotFoundPage/NotFoundPage.module.scss'

/** The mark drawn for each ground, as the side menu's logo picks it. */
const MARKS = {
  dark: '/brand/raven-mark-on-dark.svg',
  light: '/brand/raven-mark-on-light.svg',
} as const

/**
 * What an address that names nothing shows: a 4, an empty poster holding
 * the mark, and a 4, then the way back to the libraries or home. The three
 * figures are decoration; the heading says what happened.
 */
export const NotFoundPage = () => {
  const tone = useTheme((state) => themeOf(state.theme).tone)
  return (
    <section className={styles.page}>
      <BackButton fallback={{ to: '/', label: 'Home' }} className={styles.back} />
      <p className={styles.figures} aria-hidden="true">
        <span>4</span>
        <span className={styles.poster}>
          <img src={MARKS[tone]} alt="" width={646} height={705} className={styles.mark} />
        </span>
        <span>4</span>
      </p>
      <h1 className={styles.title}>Nothing lives at this address</h1>
      <p className={styles.copy}>
        The library or video may have been removed, or the link is incomplete.
      </p>
      <nav className={styles.actions} aria-label="Ways back">
        <ButtonLink to="/libraries" tone="primary" size="large">
          Back to libraries
        </ButtonLink>
        <ButtonLink to="/" size="large">
          Go home
        </ButtonLink>
      </nav>
    </section>
  )
}
