import styles from '@/components/TmdbCredit/TmdbCredit.module.scss'

/** TMDB's attribution, which every page showing its data carries at its foot. */
export const TmdbCredit = () => (
  <footer className={styles.credit}>
    <a href="https://www.themoviedb.org/" className={styles.logo} rel="noreferrer" target="_blank">
      <img src="/tmdb.svg" alt="TMDB" width={120} height={16} />
    </a>
    <p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
  </footer>
)
