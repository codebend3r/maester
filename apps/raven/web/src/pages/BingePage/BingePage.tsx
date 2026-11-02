import { useQueries } from '@tanstack/react-query'
import { useId } from 'react'
import { Link } from 'react-router-dom'
import { ITEM_TYPES } from '@raven/core'
import { Button, ButtonLink, Icon } from '@raven/ui'
import { BackButton, HOME } from '@/components/BackButton/BackButton'
import { PageTitle } from '@/components/PageTitle/PageTitle'
import { SectionHeading } from '@/components/SectionHeading/SectionHeading'
import { BingeCard } from '@/components/BingeCard/BingeCard'
import { BINGE_BROWSE_PATH, BINGE_COPY, BINGE_PATH } from '@/lib/binge'
import { bingeQuery } from '@/lib/bingeQuery'
import { useBingeProfile, useSetBinge } from '@/lib/useBinge'
import styles from '@/pages/BingePage/BingePage.module.scss'

type BingeSectionProps = { isHome?: boolean }

export const BingeSection = ({ isHome = false }: BingeSectionProps) => {
  const headingId = useId()
  const { ids, isPending: isListPending } = useBingeProfile()
  const setBinge = useSetBinge()
  const queries = useQueries({ queries: ids.map((id) => bingeQuery(id)) })
  const shows = queries.flatMap((query) =>
    query.isSuccess && query.data !== null && query.data.type === ITEM_TYPES.show
      ? [query.data]
      : [],
  )
  const hasShows = shows.length > 0
  const isPending = queries.some((query) => query.isPending)
  const failures = queries.flatMap((query, index) => {
    const id = ids[index]
    return id !== undefined &&
      (query.isError ||
        (query.isSuccess && (query.data === null || query.data.type !== ITEM_TYPES.show)))
      ? [{ id, query }]
      : []
  })

  return (
    <>
      {(!isHome || hasShows) && (
        <section className={styles.section} aria-labelledby={isHome ? headingId : undefined}>
          {isHome && (
            <SectionHeading id={headingId}>
              <Link to={BINGE_PATH}>{BINGE_COPY.title}</Link>
            </SectionHeading>
          )}
          {!isHome && !isListPending && ids.length === 0 && (
            <section className={styles.empty}>
              <Icon name="playback" size={40} />
              <h2>{BINGE_COPY.emptyTitle}</h2>
              <p>{BINGE_COPY.emptyBody}</p>
              <p>{BINGE_COPY.emptyHelp}</p>
              <ButtonLink to={BINGE_BROWSE_PATH} icon="libraries">
                {BINGE_COPY.browse}
              </ButtonLink>
            </section>
          )}
          {!isHome && isPending && <output>{BINGE_COPY.loading}</output>}
          {!isHome &&
            failures.map(({ id, query }) => (
              <section key={id} className={styles.failure}>
                <p role="alert">{BINGE_COPY.unavailable}</p>
                <Button
                  onClick={() => {
                    query.refetch().catch(() => undefined)
                  }}
                >
                  {BINGE_COPY.retry}
                </Button>
                <Button onClick={() => setBinge.mutate({ id, binge: false })}>
                  {BINGE_COPY.remove}
                </Button>
              </section>
            ))}
          {hasShows && (
            <ul className={styles.grid}>
              {shows.map((item) => (
                <BingeCard key={item.id} details={item} />
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  )
}

export const BingePage = () => {
  const titleId = useId()
  return (
    <section className={styles.page} aria-labelledby={titleId}>
      <BackButton fallback={HOME} />
      <PageTitle id={titleId} icon="popcorn">
        {BINGE_COPY.title}
      </PageTitle>
      <BingeSection />
    </section>
  )
}
