import { useQuery } from '@tanstack/react-query'
import {
  DOWNLOAD_TARGET_KINDS,
  type ItemDetails,
  ROUTE_STATES,
  type RouteQuery,
  TITLE_DISPLAYS,
  createdBy,
  episodeCode,
  firstSeasonIn,
  picturesIn,
  seasonEntryKey,
  seasonsOf,
  seasonsWatched,
  showFacts,
  watchLink,
  watchedStateOf,
  WATCH_TARGET_KINDS,
  MATCH_SUBJECT_KINDS,
  ITEM_IMAGE_KINDS,
  ITEM_TYPES,
} from '@raven/core'
import { useId, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AdminOnly } from '@/components/AdminOnly/AdminOnly'
import { AiMatchNote } from '@/components/AiMatchNote/AiMatchNote'
import { Button, ButtonLink } from '@raven/ui'
import { KeyedView, type ViewOf, type ViewsOf } from '@raven/ui/headless'
import { CastRow } from '@/components/CastRow/CastRow'
import { PlayAllButton } from '@/components/PlayAllButton/PlayAllButton'
import { DownloadButton } from '@/components/DownloadButton/DownloadButton'
import { FavouriteButton } from '@/components/FavouriteButton/FavouriteButton'
import { FixMatchDialog } from '@/components/FixMatchDialog/FixMatchDialog'
import { ImageEditor } from '@/components/ImageEditor/ImageEditor'
import { ItemHeader, ItemHeaderSkeleton, itemBackdrop } from '@/components/ItemHeader/ItemHeader'
import { MetadataEditor } from '@/components/MetadataEditor/MetadataEditor'
import { ReviewCards } from '@/components/ReviewCards/ReviewCards'
import { RouteState } from '@/components/RouteState/RouteState'
import { SelectButton } from '@/components/SelectButton/SelectButton'
import { SelectionBar } from '@/components/SelectionBar/SelectionBar'
import { SelectionScope, sourceOf } from '@/components/SelectionScope/SelectionScope'
import { ShuffleButton } from '@/components/ShuffleButton/ShuffleButton'
import { Summary } from '@/components/Summary/Summary'
import { TmdbCredit } from '@/components/TmdbCredit/TmdbCredit'
import { WatchedToggle } from '@/components/WatchedToggle/WatchedToggle'
import { HeroToggle } from '@/components/HeroToggle/HeroToggle'
import { api } from '@/lib/api'
import { displaySettingsQuery, librariesQuery, nextEpisodeQuery } from '@/lib/queries'
import { useRouteItem } from '@/lib/routeQuery'
import { useItemFavourite } from '@/lib/useItemFavourite'
import { useWatchedToggle } from '@/lib/useWatchedChange'
import { SHOW_COPY } from '@/pages/ShowPage/copy'
import styles from '@/pages/ShowPage/ShowPage.module.scss'
import { COMMON_COPY } from '@/lib/copy'
import { BingeButton } from '@/components/BingeButton/BingeButton'
import { ShowSeasons } from '@/components/ShowSeasons/ShowSeasons'

type ShowViewProps = { details: ItemDetails }

const ShowView = ({ details }: ShowViewProps) => {
  const ids = { title: useId() }
  const navigate = useNavigate()
  const [fixing, setFixing] = useState(false)
  const [editingImages, setEditingImages] = useState(false)
  const [editingMetadata, setEditingMetadata] = useState(false)
  const next = useQuery(nextEpisodeQuery(details.id))
  const favourite = useItemFavourite({ item: details })
  // A logo until Settings says to spell titles out, as a fresh install does.
  const showsLogo = useQuery(displaySettingsQuery).data?.titles !== TITLE_DISPLAYS.text
  const libraryId = next.data?.libraryId ?? details.versions[0]?.libraryId ?? null
  const known = useQuery(librariesQuery).data ?? []
  const libraryName = known.find((entry) => entry.id === libraryId)?.name ?? COMMON_COPY.library
  // Each library holding the show can choose its own pictures.
  const pictures = picturesIn({ details, libraryId })
  const library = {
    to: libraryId == null ? '/libraries' : `/libraries/${libraryId}`,
    label: libraryName,
  }
  const code = next.data?.item ? episodeCode(next.data.item) : null
  const seasons = seasonsOf(details)
  const marks = seasonsWatched(seasons)
  const firstSeason = firstSeasonIn(seasons)
  const toggle = useWatchedToggle({
    state: watchedStateOf(marks),
    targets: [{ kind: WATCH_TARGET_KINDS.item, id: details.id, libraryId: null }],
  })

  return (
    <SelectionScope
      {...sourceOf(
        seasons.map((season) => [
          seasonEntryKey(season),
          [{ kind: WATCH_TARGET_KINDS.item, id: season.id, libraryId: null }],
        ]),
      )}
    >
      <article className={styles.page} aria-labelledby={ids.title}>
        <ItemHeader
          back={library}
          library={library}
          pullUp
          titleId={ids.title}
          eyebrow={[SHOW_COPY.eyebrow]}
          title={details.title}
          logo={
            showsLogo
              ? api.itemImageUrl({
                  id: details.id,
                  kind: ITEM_IMAGE_KINDS.logo,
                  version: pictures.logoVersion,
                })
              : null
          }
          byline={createdBy(details)}
          contentRating={details.contentRating}
          facts={showFacts(details)}
          ratings={details.ratings}
          picture={{
            shape: 'poster',
            url: api.itemImageUrl({
              id: details.id,
              kind: ITEM_IMAGE_KINDS.poster,
              version: pictures.posterVersion,
            }),
          }}
          backdrop={itemBackdrop({ id: details.id, version: pictures.backdropVersion })}
          manage={
            <AdminOnly>
              <Button
                icon="edit"
                aria-pressed={editingImages}
                onClick={() => setEditingImages((editing) => !editing)}
              >
                {COMMON_COPY.editImages}
              </Button>
              <Button
                icon="edit"
                aria-pressed={editingMetadata}
                onClick={() => setEditingMetadata((editing) => !editing)}
              >
                {COMMON_COPY.editMetadata}
              </Button>
              <Button icon="search" onClick={() => setFixing(true)}>
                {COMMON_COPY.fixMatch}
              </Button>
              <HeroToggle itemId={details.id} />
            </AdminOnly>
          }
        >
          {next.data && (
            <ButtonLink tone="primary" icon="play" {...watchLink({ media: next.data })}>
              {SHOW_COPY.play(code)}
            </ButtonLink>
          )}
          {firstSeason && marks.total > 0 && <PlayAllButton seasonId={firstSeason.id} />}
          <BingeButton item={details} />
          {details.favourite != null && (
            <FavouriteButton isFavourite={details.favourite} onToggle={favourite.mutate} />
          )}
          {marks.total > 0 && (
            <ShuffleButton itemId={details.id} isWholeShow>
              {COMMON_COPY.shuffle}
            </ShuffleButton>
          )}
          <DownloadButton target={{ kind: DOWNLOAD_TARGET_KINDS.item, itemId: details.id }} />
          <WatchedToggle {...toggle} />
          <SelectButton />
        </ItemHeader>

        {details.aiMatch && <AiMatchNote aiMatch={details.aiMatch} />}

        <AdminOnly>
          {editingImages && (
            <ImageEditor
              details={details}
              libraries={known}
              libraryId={libraryId}
              itemKind={ITEM_TYPES.show}
              onDone={() => setEditingImages(false)}
            />
          )}
          {editingMetadata && (
            <MetadataEditor
              details={details}
              itemKind={ITEM_TYPES.show}
              onDone={() => setEditingMetadata(false)}
            />
          )}
        </AdminOnly>

        <Summary tagline={details.tagline} summary={details.summary} />

        {seasons.length > 0 && <ShowSeasons seasons={seasons} show={details} />}

        <CastRow credits={details.credits} />
        <ReviewCards reviews={details.reviews} />
        <TmdbCredit />

        <SelectionBar />

        <AdminOnly>
          {fixing && (
            <FixMatchDialog
              type={ITEM_TYPES.show}
              title={details.title}
              year={details.year}
              libraryId={libraryId}
              subject={{ kind: MATCH_SUBJECT_KINDS.item, id: details.id }}
              aiMatch={details.aiMatch}
              allowNone={false}
              match={(tmdbId) =>
                tmdbId == null
                  ? Promise.reject(new Error('Pick a show.'))
                  : api.setItemMatch({ itemId: details.id, tmdbId })
              }
              onMatched={(moved) => navigate(`/shows/${moved.id}`, { replace: true })}
              onClose={() => setFixing(false)}
            />
          )}
        </AdminOnly>
      </article>
    </SelectionScope>
  )
}

const SHOW_VIEW_KEYS = { pending: 'pending', ready: 'ready' } as const

type ShowViewsProps = {
  [SHOW_VIEW_KEYS.pending]: Parameters<typeof RouteState>[0]
  [SHOW_VIEW_KEYS.ready]: ShowViewProps
}

const SHOW_VIEWS = {
  [SHOW_VIEW_KEYS.pending]: RouteState,
  [SHOW_VIEW_KEYS.ready]: ShowView,
} as const satisfies ViewsOf<ShowViewsProps>

type ShowPageViewProps = { page: RouteQuery<ItemDetails> }

/** The show on its way or failing, else the show. */
const showPageView = ({ page }: ShowPageViewProps): ViewOf<ShowViewsProps> => {
  if (page.state !== ROUTE_STATES.ready)
    return {
      key: SHOW_VIEW_KEYS.pending,
      props: { state: page, noun: SHOW_COPY.noun, shape: <ItemHeaderSkeleton picture="poster" /> },
    }
  return { key: SHOW_VIEW_KEYS.ready, props: { details: page.data } }
}

/**
 * `/shows/:id`: a show's backdrop, poster, creator, years, network, scores,
 * Play for the next episode and Shuffle for a random one, then its summary,
 * its seasons as a grid of posters or a table, its people and its reviews.
 */
export const ShowPage = () => {
  const page = useRouteItem(ITEM_TYPES.show)
  return <KeyedView<ShowViewsProps> views={SHOW_VIEWS} view={showPageView({ page })} />
}
