import {
  KIT_COPY,
  RECENT_KINDS,
  type RecentPage,
  type RecentSearch,
  SEARCH_COPY,
  isRecentPage,
  recentKeyOf,
  recentTextOf,
} from '@raven/wren'
import {
  COLLECTION_KINDS,
  type CollectionKind,
  albumPath,
  artistPath,
  collectionPath,
} from '@/routes'
import { useRecentSearches } from '@/stores/recentSearches'
import { COLORS, type Color, SIZES, type TokenStyle } from '@/theme/tokens'
import { IconButton } from '@/ui/IconButton/IconButton'
import { Pressable } from '@/ui/Pressable/Pressable'
import { SectionHeader } from '@/ui/SectionHeader/SectionHeader'
import { ICONS, type WrenIconName } from '@/ui/WrenIcon/icons'
import { WrenIcon } from '@/ui/WrenIcon/WrenIcon'
import styles from '@/screens/Search/SearchIdle.module.scss'

/** A Browse tile: the list it opens, and the art colours it wears. */
type BrowseTile = {
  kind: CollectionKind
  label: string
  icon: WrenIconName
  ground: Color
  ink: Color
}

// The apps' tiles but Downloaded, since a browser keeps no downloads.
const BROWSE_TILES = [
  {
    kind: COLLECTION_KINDS.albums,
    label: SEARCH_COPY.albums,
    icon: ICONS.album,
    ground: COLORS.artInk,
    ink: COLORS.artOchre,
  },
  {
    kind: COLLECTION_KINDS.artists,
    label: SEARCH_COPY.artists,
    icon: ICONS.artist,
    ground: COLORS.artDusk,
    ink: COLORS.artBlush,
  },
  {
    kind: COLLECTION_KINDS.songs,
    label: SEARCH_COPY.songs,
    icon: ICONS.song,
    ground: COLORS.artSlate,
    ink: COLORS.artCream,
  },
] as const satisfies readonly BrowseTile[]

const tileStyleOf = ({ ground, ink }: BrowseTile): TokenStyle => ({
  '--tile-ground': ground,
  '--tile-ink': ink,
})

/** Albums, Artists and Songs, each opening Library's list of them. */
function Browse() {
  return (
    <section className={styles.section}>
      <SectionHeader title={SEARCH_COPY.browse} />
      <ul className={styles.tiles}>
        {BROWSE_TILES.map((tile) => (
          <li className={styles.cell} key={tile.kind} style={tileStyleOf(tile)}>
            <Pressable className={styles.tile} href={collectionPath(tile.kind)} label={tile.label}>
              <WrenIcon color={tile.ink} name={tile.icon} size={SIZES.largeIcon} />
              <span className={styles.tileLabel}>{tile.label}</span>
            </Pressable>
          </li>
        ))}
      </ul>
    </section>
  )
}

type RecentViewProps = { recent: RecentSearch }

/** The page each kind of recent search opens, by its id. */
const RECENT_PATHS = {
  [RECENT_KINDS.artist]: artistPath,
  [RECENT_KINDS.album]: albumPath,
} as const satisfies Record<RecentPage['kind'], (id: number) => string>

/** The page a recent artist or album opens, a link's address; a search has none and runs here. */
const recentHrefOf = ({ recent }: RecentViewProps): string | undefined =>
  isRecentPage(recent) ? RECENT_PATHS[recent.kind](recent.id) : undefined

type RecentRowProps = RecentViewProps & { onSearch: (text: string) => void }

/*
 * A recent search: a press searches again, or is a link to its artist's or album's page, either
 * way moving it back to the top of the list, and its x forgets it.
 */
function RecentRow({ recent, onSearch }: RecentRowProps) {
  const remember = useRecentSearches((state) => state.remember)
  const forget = useRecentSearches((state) => state.forget)
  const { name, line } = recentTextOf(recent)
  const open = () => {
    remember(recent)
    if (!isRecentPage(recent)) onSearch(recent.text)
  }
  return (
    <li className={styles.recent}>
      <Pressable
        className={styles.recentMain}
        href={recentHrefOf({ recent })}
        label={KIT_COPY.labelled({ label: name, value: line })}
        onPress={open}
      >
        <WrenIcon color={COLORS.text3} name={ICONS.recent} size={SIZES.icon} />
        <span className={styles.recentText}>
          <span className={styles.recentName}>{name}</span>
          <span className={styles.recentLine}>{line}</span>
        </span>
      </Pressable>
      <IconButton
        color={COLORS.text3}
        icon={ICONS.close}
        label={SEARCH_COPY.removeRecent(name)}
        onPress={() => forget(recentKeyOf(recent))}
        size={SIZES.smallButton}
      />
    </li>
  )
}

type SearchIdleProps = { onSearch: (text: string) => void }

/** The searches made here lately, newest first, with Clear; nothing while there are none. */
function RecentList({ onSearch }: SearchIdleProps) {
  const recents = useRecentSearches((state) => state.recents)
  const clear = useRecentSearches((state) => state.clear)
  return (
    recents.length > 0 && (
      <section className={styles.recents}>
        <SectionHeader
          action={{
            label: SEARCH_COPY.clearRecent,
            spoken: SEARCH_COPY.clearRecentLabel,
            onPress: clear,
          }}
          title={SEARCH_COPY.recent}
        />
        <ul className={styles.recentRows}>
          {recents.map((recent) => (
            <RecentRow key={recentKeyOf(recent)} onSearch={onSearch} recent={recent} />
          ))}
        </ul>
      </section>
    )
  )
}

/** Search before anything is typed: the Browse tiles and the recent searches. */
export function SearchIdle({ onSearch }: SearchIdleProps) {
  return (
    <div className={styles.idle}>
      <Browse />
      <RecentList onSearch={onSearch} />
    </div>
  )
}
