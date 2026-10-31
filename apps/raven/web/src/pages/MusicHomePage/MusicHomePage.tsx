import { useQuery } from '@tanstack/react-query'
import { type ReactNode, useId } from 'react'
import { AlbumGrid, AlbumGridSkeleton } from '@/components/AlbumGrid/AlbumGrid'
import { ListState } from '@/components/ListState/ListState'
import { MixGrid } from '@/components/MixGrid/MixGrid'
import { PageTitle } from '@/components/PageTitle/PageTitle'
import { SectionHeading } from '@/components/SectionHeading/SectionHeading'
import { MUSIC_COPY } from '@/lib/copy'
import { mixesQuery, recentMusicQuery } from '@/lib/queries'
import { useMusicLibraries } from '@/lib/useMusicListings'
import { MUSIC_HOME_COPY } from '@/pages/MusicHomePage/copy'
import styles from '@/pages/MusicHomePage/MusicHomePage.module.scss'

type ShelfProps = { title: string; children: ReactNode }

/** One of Home's shelves under its heading. */
const Shelf = ({ title, children }: ShelfProps) => {
  const id = useId()
  return (
    <section className={styles.shelf} aria-labelledby={id}>
      <SectionHeading id={id}>{title}</SectionHeading>
      {children}
    </section>
  )
}

/**
 * `/music`: the music mode's Home. The mixes made from the account's plays
 * for today, then the albums it played last, then the albums added last.
 */
export const MusicHomePage = () => {
  const titleId = useId()
  const music = useMusicLibraries()
  const recent = useQuery(recentMusicQuery)
  const mixes = useQuery(mixesQuery)
  return (
    <article className={styles.page} aria-labelledby={titleId}>
      <PageTitle id={titleId} icon="music" className={styles.title}>
        {MUSIC_HOME_COPY.title}
      </PageTitle>
      {music.isRead && music.libraries.length === 0 && (
        <p className={styles.message}>{MUSIC_COPY.noMusic}</p>
      )}
      <Shelf title={MUSIC_HOME_COPY.mixes}>
        <ListState entries={mixes.data} error={mixes.error} empty={MUSIC_HOME_COPY.noMixes}>
          {(entries) => <MixGrid mixes={entries} label={MUSIC_HOME_COPY.mixes} />}
        </ListState>
      </Shelf>
      <Shelf title={MUSIC_HOME_COPY.recentlyPlayed}>
        <ListState
          entries={recent.data?.played}
          error={recent.error}
          empty={MUSIC_HOME_COPY.nothingPlayed}
          loading={<AlbumGridSkeleton />}
        >
          {(albums) => <AlbumGrid albums={albums} />}
        </ListState>
      </Shelf>
      <Shelf title={MUSIC_HOME_COPY.recentlyAdded}>
        <ListState
          entries={recent.data?.added}
          error={recent.error}
          empty={MUSIC_HOME_COPY.nothingAdded}
          loading={<AlbumGridSkeleton />}
        >
          {(albums) => <AlbumGrid albums={albums} />}
        </ListState>
      </Shelf>
    </article>
  )
}
