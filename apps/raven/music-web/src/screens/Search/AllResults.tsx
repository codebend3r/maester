import {
  ALBUMS_IN_ALL,
  FILTER_LABELS,
  SEARCH_FILTERS,
  SONGS_IN_ALL,
  type SearchFilter,
  topResultOf,
} from '@raven/wren'
import { playingIdOf, useAudioQueue } from '@raven/ui/headless'
import type { ComponentType, ReactNode } from 'react'
import { AlbumGrid } from '@/components/AlbumGrid/AlbumGrid'
import { useCovers } from '@/music/useCovers'
import {
  ALBUM_COLUMNS,
  ArtistCircles,
  type ResultsProps,
  TopResultCard,
} from '@/screens/Search/ResultParts'
import { ArtistRows, FoundSong } from '@/screens/Search/ResultRows'
import { FORM_FACTORS, type FormFactor, useFormFactor } from '@/theme/formFactor'
import { SectionHeader } from '@/ui/SectionHeader/SectionHeader'
import { Shelf } from '@/ui/Shelf/Shelf'
import styles from '@/screens/Search/SearchResults.module.scss'

type ResultSectionProps = Pick<ResultsProps, 'onFilter'> & {
  /** The kind this section shows the start of: its title, and what its See all narrows to. */
  filter: SearchFilter
  /** How many of that kind were found; none, and the section is not drawn. */
  count: number
  className: string
  children: ReactNode
}

/** One kind of result in All: its title, See all, and the start of what was found. */
function ResultSection({ filter, count, onFilter, className, children }: ResultSectionProps) {
  return (
    count > 0 && (
      <section className={className}>
        <SectionHeader seeAll={{ onPress: () => onFilter(filter) }} title={FILTER_LABELS[filter]} />
        {children}
      </section>
    )
  )
}

type SongsSectionProps = Pick<ResultsProps, 'results' | 'onFilter' | 'actions'> & {
  /** How many of the songs All shows; See all opens the rest. */
  shown: number
}

/** All's songs: the first few found, and See all. */
function SongsSection({ results, onFilter, actions, shown }: SongsSectionProps) {
  const playingId = useAudioQueue(playingIdOf)
  const { songs } = results
  return (
    <ResultSection
      className={styles.rows}
      count={songs.length}
      filter={SEARCH_FILTERS.songs}
      onFilter={onFilter}
    >
      <ul className={styles.rows}>
        {songs.slice(0, shown).map((track, index) => (
          <FoundSong
            actions={actions}
            index={index}
            key={track.id}
            playingId={playingId}
            track={track}
            tracks={songs}
          />
        ))}
      </ul>
    </ResultSection>
  )
}

/** What a search found, as All shows it on the narrow layout: the top result, then each kind in turn. */
function PhoneAll({ results, query, onFilter, actions }: ResultsProps) {
  const { coverOf } = useCovers()
  const { albums, artists, songs } = results
  const top = topResultOf({ query, albums, artists, songs })
  return (
    <div className={styles.sections}>
      {top !== null && <TopResultCard actions={actions} result={top} songs={songs} />}
      <ResultSection
        className={styles.section}
        count={albums.length}
        filter={SEARCH_FILTERS.albums}
        onFilter={onFilter}
      >
        <Shelf albums={albums} coverOf={coverOf} onOpen={actions.rememberAlbum} />
      </ResultSection>
      <ResultSection
        className={styles.section}
        count={artists.length}
        filter={SEARCH_FILTERS.artists}
        onFilter={onFilter}
      >
        <ArtistCircles actions={actions} artists={artists} />
      </ResultSection>
      <SongsSection
        actions={actions}
        onFilter={onFilter}
        results={results}
        shown={SONGS_IN_ALL[FORM_FACTORS.phone]}
      />
    </div>
  )
}

/** All on the wide layout: the songs and albums on the left, the artists on the right. */
function TabletAll({ results, onFilter, actions }: ResultsProps) {
  const { albums, artists } = results
  return (
    <div className={styles.columns}>
      <div className={styles.main}>
        <SongsSection
          actions={actions}
          onFilter={onFilter}
          results={results}
          shown={SONGS_IN_ALL[FORM_FACTORS.tablet]}
        />
        <ResultSection
          className={styles.section}
          count={albums.length}
          filter={SEARCH_FILTERS.albums}
          onFilter={onFilter}
        >
          <AlbumGrid
            albums={albums.slice(0, ALBUMS_IN_ALL)}
            columns={ALBUM_COLUMNS}
            onOpen={actions.rememberAlbum}
          />
        </ResultSection>
      </div>
      <div className={styles.side}>
        {/* The rows bring their own height, so this section has no gap under its heading. */}
        <ResultSection
          className={styles.rows}
          count={artists.length}
          filter={SEARCH_FILTERS.artists}
          onFilter={onFilter}
        >
          <ArtistRows actions={actions} results={results} />
        </ResultSection>
      </div>
    </div>
  )
}

/** Each layout's All. */
const ALL_VIEWS = {
  [FORM_FACTORS.phone]: PhoneAll,
  [FORM_FACTORS.tablet]: TabletAll,
} as const satisfies Record<FormFactor, ComponentType<ResultsProps>>

/** Everything a search found, the start of each kind, laid out for the window's width. */
export function AllResults(props: ResultsProps) {
  const All = ALL_VIEWS[useFormFactor()]
  return <All {...props} />
}
