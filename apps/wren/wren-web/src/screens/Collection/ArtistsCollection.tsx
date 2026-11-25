import { type Letter, LETTERS, plural } from '@raven/core'
import { COUNTS_COPY, LIBRARY_PAGE_COPY, firstAtLetter, matchingArtists } from '@raven/wren'
import { useRef } from 'react'
import { ArtistGrid } from '@/components/ArtistGrid/ArtistGrid'
import { ListNotice } from '@/components/ListNotice/ListNotice'
import { LIST_SHAPES } from '@/components/ListSkeleton/ListSkeleton'
import { useAllArtists } from '@/music/listings'
import { CollectionHeader } from '@/screens/Collection/CollectionHeader'
import { useCollectionSearch } from '@/screens/Collection/useCollectionSearch'
import { useListStart } from '@/screens/Collection/useListStart'
import { Page } from '@/shell/Page/Page'
import collectionStyles from '@/screens/Collection/Collection.module.scss'
import styles from '@/screens/Collection/ArtistsCollection.module.scss'

type IndexRailProps = { onLetter: (letter: Letter) => void }

/** The A to Z rail down the right edge: a letter jumps the list to the first artist under it. */
function IndexRail({ onLetter }: IndexRailProps) {
  return (
    <ul className={styles.rail}>
      {LETTERS.map((letter) => (
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

/**
 * Artists: every music library's, each once, by name, as a grid of cards like raven's Artists
 * tab, with an A to Z rail to jump the grid to the first card under a letter.
 */
export function ArtistsCollection() {
  const search = useCollectionSearch({
    placeholder: LIBRARY_PAGE_COPY.searchArtists,
    none: LIBRARY_PAGE_COPY.noArtists,
  })
  const grid = useRef<HTMLUListElement>(null)
  const { artists, listing } = useAllArtists({ search: '' })
  const shown = matchingArtists({ artists, query: search.query })
  const count = listing.isRead ? plural({ n: shown.length, ...COUNTS_COPY.artists }) : null
  const { listing: listingStart, header } = useListStart({ isShown: shown.length > 0 })
  const jump = (letter: Letter) => {
    const at = firstAtLetter({ names: shown.map(({ sortName }) => sortName), letter })
    if (at === null) return
    grid.current?.children.item(at)?.scrollIntoView({ block: 'start' })
  }
  return (
    <Page className={collectionStyles.artists}>
      <CollectionHeader
        count={count}
        ref={header}
        search={search.field}
        title={LIBRARY_PAGE_COPY.artists}
      />
      {shown.length === 0 && (
        <ListNotice empty={search.empty} listing={listing} shape={LIST_SHAPES.tiles} />
      )}
      {shown.length > 0 && (
        <div className={styles.listing} ref={listingStart}>
          <ArtistGrid artists={shown} className={styles.grid} ref={grid} />
          <IndexRail onLetter={jump} />
        </div>
      )}
    </Page>
  )
}
