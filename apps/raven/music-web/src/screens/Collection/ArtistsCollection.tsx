import { plural } from '@raven/core'
import {
  COUNTS_COPY,
  INDEX_LETTERS,
  LIBRARY_PAGE_COPY,
  firstAtLetter,
  matchingArtists,
} from '@raven/wren'
import { useRef } from 'react'
import { ListNotice } from '@/components/ListNotice/ListNotice'
import { useAllArtists } from '@/music/listings'
import { useCovers } from '@/music/useCovers'
import { artistPath } from '@/routes'
import { CollectionHeader } from '@/screens/Collection/CollectionHeader'
import { useCollectionSearch } from '@/screens/Collection/useCollectionSearch'
import { useListStart } from '@/screens/Collection/useListStart'
import { Page } from '@/shell/Page/Page'
import { ArtistRow } from '@/ui/ArtistRow/ArtistRow'
import collectionStyles from '@/screens/Collection/Collection.module.scss'
import styles from '@/screens/Collection/ArtistsCollection.module.scss'

type IndexRailProps = { onLetter: (letter: string) => void }

/** The A to Z rail down the right edge: a letter jumps the list to the first artist under it. */
function IndexRail({ onLetter }: IndexRailProps) {
  return (
    <ul className={styles.rail}>
      {INDEX_LETTERS.map((letter) => (
        <li className={styles.entry} key={letter}>
          <button
            aria-label={LIBRARY_PAGE_COPY.jumpTo(letter)}
            className={styles.letter}
            onClick={() => onLetter(letter)}
            type="button"
          >
            {letter}
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Artists: every music library's, each once, by name, with an A to Z rail to jump the list. */
export function ArtistsCollection() {
  const search = useCollectionSearch({
    placeholder: LIBRARY_PAGE_COPY.searchArtists,
    none: LIBRARY_PAGE_COPY.noArtists,
  })
  const list = useRef<HTMLUListElement>(null)
  const { artists, listing } = useAllArtists({ search: '' })
  const { artistPhotoOf } = useCovers()
  const shown = matchingArtists({ artists, query: search.query })
  const count = listing.isRead ? plural({ n: shown.length, ...COUNTS_COPY.artists }) : null
  const { listing: listingStart, header } = useListStart({ isShown: shown.length > 0 })
  const jump = (letter: string) => {
    const at = firstAtLetter({ names: shown.map(({ sortName }) => sortName), letter })
    if (at === null) return
    list.current?.children.item(at)?.scrollIntoView({ block: 'start' })
  }
  return (
    <Page className={collectionStyles.artists}>
      <CollectionHeader
        count={count}
        ref={header}
        search={search.field}
        title={LIBRARY_PAGE_COPY.artists}
      />
      {shown.length === 0 && <ListNotice empty={search.empty} listing={listing} />}
      {shown.length > 0 && (
        <div className={styles.listing} ref={listingStart}>
          <ul className={styles.list} ref={list}>
            {shown.map((artist) => (
              <li className={styles.row} key={artist.id}>
                <ArtistRow
                  albumCount={artist.albumCount}
                  href={artistPath(artist.id)}
                  name={artist.name}
                  picture={artistPhotoOf(artist)}
                  trackCount={artist.trackCount}
                />
              </li>
            ))}
          </ul>
          <IndexRail onLetter={jump} />
        </div>
      )}
    </Page>
  )
}
