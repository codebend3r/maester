import { LIBRARY_PAGE_COPY, RECENT_SORTS } from '@raven/wren'
import { useNavigate } from 'react-router-dom'
import { AlbumGrid } from '@/components/AlbumGrid/AlbumGrid'
import { ListNotice } from '@/components/ListNotice/ListNotice'
import { LIST_SHAPES } from '@/components/ListSkeleton/ListSkeleton'
import { Section } from '@/components/Section/Section'
import { useLibraryValues, useRecentAlbums } from '@/music/listings'
import { WREN_ROUTES } from '@/routes'
import { Page } from '@/shell/Page/Page'
import { LIBRARY_PLACES } from '@/shell/places'
import { FORM_FACTORS, type FormFactor, useFormFactor } from '@/theme/formFactor'
import { COLORS } from '@/theme/tokens'
import { IconButton } from '@/ui/IconButton/IconButton'
import { NAVIGATION_ROW_VARIANTS, NavigationRow } from '@/ui/NavigationRow/NavigationRow'
import { PageHeader } from '@/ui/PageHeader/PageHeader'
import { ICONS } from '@/ui/WrenIcon/icons'
import styles from '@/screens/Library/Library.module.scss'

/** How many of the newest albums Library's grid shows: three rows on the narrow layout, two on the wide. */
const RECENT_SHOWN = {
  [FORM_FACTORS.phone]: 6,
  [FORM_FACTORS.tablet]: 10,
} as const satisfies Record<FormFactor, number>

/** The newest albums of every music library, as a grid. */
function RecentGrid() {
  const { albums, listing } = useRecentAlbums({
    sort: RECENT_SORTS.added,
    limit: RECENT_SHOWN[useFormFactor()],
  })
  return (
    <Section title={LIBRARY_PAGE_COPY.recent}>
      {albums.length === 0 && (
        <ListNotice
          empty={LIBRARY_PAGE_COPY.noAlbums}
          listing={listing}
          shape={LIST_SHAPES.tiles}
        />
      )}
      <AlbumGrid albums={albums} />
    </Section>
  )
}

/**
 * `/library`: its categories, each a page of its own with what it holds beside it, and the
 * newest albums of every music library under them.
 */
export function Library() {
  const navigate = useNavigate()
  /*
   * Each category's count, summed over every music library: the server counts the albums, the
   * artists, the unmatched albums, what is in progress, the favourites and what was finished;
   * the playlists are the account's and the songs each library's total. A count still on its
   * way, one that failed and a zero are left out rather than guessed.
   */
  const values = useLibraryValues()
  return (
    <Page>
      <PageHeader
        actions={
          <IconButton
            color={COLORS.text}
            icon={ICONS.search}
            label={LIBRARY_PAGE_COPY.search}
            onPress={() => navigate(WREN_ROUTES.search)}
          />
        }
        title={LIBRARY_PAGE_COPY.title}
      />
      <ul className={styles.rows}>
        {LIBRARY_PLACES.map((place) => (
          <li className={styles.row} key={place.kind}>
            <NavigationRow
              href={place.path}
              icon={place.icon}
              label={place.label}
              value={values[place.kind]}
              variant={NAVIGATION_ROW_VARIANTS.library}
            />
          </li>
        ))}
      </ul>
      <RecentGrid />
    </Page>
  )
}
