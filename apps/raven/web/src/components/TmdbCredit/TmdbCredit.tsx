import { TMDB_CREDIT_COPY } from '@/components/TmdbCredit/copy'
import styles from '@/components/TmdbCredit/TmdbCredit.module.scss'
import { COMMON_COPY } from '@/lib/copy'

/** TMDB's attribution, which every page showing its data carries at its foot, in a quiet line. */
export const TmdbCredit = () => (
  <footer className={styles.credit}>
    <a href="https://www.themoviedb.org/" className={styles.logo} rel="noreferrer" target="_blank">
      <img src="/tmdb.svg" alt={COMMON_COPY.tmdb} width={120} height={16} />
    </a>
    <p>{TMDB_CREDIT_COPY.notice}</p>
  </footer>
)
