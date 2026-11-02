import { useQuery } from '@tanstack/react-query'
import { useId } from 'react'
import { BackButton, HOME } from '@/components/BackButton/BackButton'
import { PageTitle } from '@/components/PageTitle/PageTitle'
import { homeQuery } from '@/lib/queries'
import { CONTINUE_WATCHING_COPY } from '@/pages/ContinueWatchingPage/copy'
import styles from '@/pages/ContinueWatchingPage/ContinueWatchingPage.module.scss'
import { ContinueTiles } from '@/pages/HomePage/ContinueWatching'

/**
 * `/continue-watching`: every video in progress, the most recently watched
 * first, as the tiles the home page shows the first few of.
 */
export const ContinueWatchingPage = () => {
  const titleId = useId()
  const home = useQuery(homeQuery)
  const entries = home.data?.inProgress ?? []
  return (
    <section className={styles.page} aria-labelledby={titleId}>
      <header className={styles.header}>
        <BackButton fallback={HOME} className={styles.back} />
        <PageTitle id={titleId} icon="continue">
          {CONTINUE_WATCHING_COPY.title}
        </PageTitle>
        <p className={styles.intro}>{CONTINUE_WATCHING_COPY.intro}</p>
      </header>
      {home.isError && (
        <p className={styles.message} role="alert">
          {home.error.message}
        </p>
      )}
      {home.isPending && (
        <output className={styles.message}>{CONTINUE_WATCHING_COPY.loading}</output>
      )}
      {home.isSuccess && entries.length === 0 && (
        <p className={styles.message}>{CONTINUE_WATCHING_COPY.empty}</p>
      )}
      {entries.length > 0 && <ContinueTiles entries={entries} />}
    </section>
  )
}
