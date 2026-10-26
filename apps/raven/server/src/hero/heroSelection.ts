import { Inject, Injectable } from '@nestjs/common'
import { HOME_SHELF_TYPES, type Hero, ITEM_TYPES, type ItemSummary, listsShows } from '@raven/core'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { HeroRepository } from '@/hero/heroRepository'
import { type LibraryRecord, LibrariesRepository } from '@/libraries/librariesRepository'
import type { Viewer } from '@/lock/lockService'
import { MediaRepository } from '@/media/mediaRepository'
import type { AccountKey } from '@/media/viewingAccountKeys'
import { MetadataRepository } from '@/metadata/metadataRepository'

/**
 * How many times the hero's size a library's newest releases are read for,
 * since a title with no poster or no backdrop is passed over.
 */
const POOL_FACTOR = 2

/** A title the hero could show, and where in the library it stands. */
type Candidate = { itemId: number; entry: Hero[number] }

/** `candidates` with a title held by several libraries kept in the first only. */
const distinct = (candidates: readonly Candidate[]): Candidate[] =>
  candidates.filter(
    ({ itemId }, index) => candidates.findIndex((other) => other.itemId === itemId) === index,
  )

const hasArtwork = (item: ItemSummary | null): item is ItemSummary =>
  item != null && item.posterVersion != null && item.backdropVersion != null

type HeroSelectionCandidatesProps = {
  library: LibraryRecord
  itemIds: readonly number[]
  account: AccountKey
}

type HeroSelectionNewestInProps = {
  library: LibraryRecord
  account: AccountKey
}

type HeroSelectionEntriesProps = { viewer: Viewer; account: AccountKey }

type HeroSelectionCanPickProps = {
  itemId: number
  viewer: Viewer
  account: AccountKey
}

/**
 * What home's hero shows, from the pinned libraries the caller may see that
 * are not left out of it, and never from a locked one. The movies and shows the admin picked, in the order
 * they were picked, first; then each library's most recently released title,
 * then each one's second, and so on, to fill what the picks leave. At most
 * `HERO_COUNT`, and only titles with the poster and the backdrop the hero
 * lays out.
 */
@Injectable()
export class HeroSelection {
  constructor(
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(HeroRepository) private readonly picks: HeroRepository,
    @Inject(LibrariesRepository) private readonly libraries: LibrariesRepository,
    @Inject(MediaRepository) private readonly media: MediaRepository,
    @Inject(MetadataRepository) private readonly metadata: MetadataRepository,
  ) {}

  /** How many titles the hero holds at most. */
  get limit(): number {
    return this.config.heroCount
  }

  /**
   * The libraries the hero draws on for this caller: pinned, included, and
   * seen. A locked library is never one, for anyone, unlocked or not, so
   * nothing of it can reach the hero.
   */
  private pinnedFor(viewer: Viewer): LibraryRecord[] {
    return this.libraries
      .list()
      .filter(
        ({ id, settings }) =>
          settings.pinned && settings.inHero && !settings.locked && viewer.seesLibrary(id),
      )
  }

  /** The titles among `itemIds` that `library` holds and the hero can lay out, in the order given. */
  private candidates({ library, itemIds, account }: HeroSelectionCandidatesProps): Candidate[] {
    if (itemIds.length === 0) return []
    const { id: libraryId, settings } = library
    if (listsShows(settings.kind)) {
      const entries = new Map(
        this.media
          .listShows({ libraryId, showIds: itemIds, account })
          .map((entry) => [entry.show.id, entry]),
      )
      return itemIds.flatMap((itemId): Candidate[] => {
        const entry = entries.get(itemId)
        return entry && hasArtwork(entry.show)
          ? [{ itemId, entry: { libraryId, type: HOME_SHELF_TYPES.shows, entry, line: null } }]
          : []
      })
    }
    const files = this.media.forItems({ itemIds, account })
    return itemIds.flatMap((itemId): Candidate[] => {
      const media = (files.get(itemId) ?? []).find((file) => file.libraryId === libraryId)
      return media && hasArtwork(media.item)
        ? [{ itemId, entry: { libraryId, type: HOME_SHELF_TYPES.media, media, line: null } }]
        : []
    })
  }

  /** `library`'s most recently released titles, newest first. */
  private newestIn({ library, account }: HeroSelectionNewestInProps): Candidate[] {
    const type = listsShows(library.settings.kind) ? ITEM_TYPES.show : ITEM_TYPES.movie
    const itemIds = this.media.newestReleased({
      libraryId: library.id,
      type,
      limit: this.limit * POOL_FACTOR,
    })
    return this.candidates({ library, itemIds, account })
  }

  private withLines(candidates: readonly Candidate[]): Hero {
    const blurbs = this.metadata.blurbs(candidates.map(({ itemId }) => itemId))
    return candidates.map(({ itemId, entry }) => ({ ...entry, line: blurbs.get(itemId) ?? null }))
  }

  entries({ viewer, account }: HeroSelectionEntriesProps): Hero {
    const pinned = this.pinnedFor(viewer)
    const picked = this.picks.picks()
    const chosen =
      picked.length === 0
        ? []
        : distinct(
            pinned.flatMap((library) => this.candidates({ library, itemIds: picked, account })),
          ).toSorted((a, b) => picked.indexOf(a.itemId) - picked.indexOf(b.itemId))
    const lists = pinned.map((library) => this.newestIn({ library, account }))
    const depth = Math.max(0, ...lists.map((list) => list.length))
    const rounds = Array.from({ length: depth }, (_, round) =>
      lists.flatMap((list) => list.slice(round, round + 1)),
    )
    return this.withLines(distinct([...chosen, ...rounds.flat()]).slice(0, this.limit))
  }

  /** Whether `itemId` is a movie or show held by a pinned library `viewer` may see, so the admin may pick it. */
  canPick({ itemId, viewer, account }: HeroSelectionCanPickProps): boolean {
    return this.pinnedFor(viewer).some(
      (library) => this.candidates({ library, itemIds: [itemId], account }).length > 0,
    )
  }
}
