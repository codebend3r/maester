import { useQuery } from '@tanstack/react-query'
import {
  ITEM_TYPES,
  type ItemDetails,
  TITLE_DISPLAYS,
  type SeasonSummary,
  episodeCode,
  watchedStateOf,
} from '@raven/core'
import { useId, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AdminOnly } from '@/components/AdminOnly/AdminOnly'
import { AiMatchNote } from '@/components/AiMatchNote/AiMatchNote'
import { Button, ButtonLink } from '@raven/ui'
import { CastRow } from '@/components/CastRow/CastRow'
import { FavouriteButton } from '@/components/FavouriteButton/FavouriteButton'
import { FixMatchDialog } from '@/components/FixMatchDialog/FixMatchDialog'
import { ImageEditor } from '@/components/ImageEditor/ImageEditor'
import { ItemHeader, ItemHeaderSkeleton, pictureBackdrop } from '@/components/ItemHeader/ItemHeader'
import { MetadataEditor } from '@/components/MetadataEditor/MetadataEditor'
import { ReviewCards } from '@/components/ReviewCards/ReviewCards'
import { RouteState } from '@/components/RouteState/RouteState'
import { SectionHeading } from '@/components/SectionHeading/SectionHeading'
import { SelectButton } from '@/components/SelectButton/SelectButton'
import { SelectCheckbox } from '@/components/SelectCheckbox/SelectCheckbox'
import { SelectionBar } from '@/components/SelectionBar/SelectionBar'
import { SelectionScope, sourceOf } from '@/components/SelectionScope/SelectionScope'
import { ShuffleButton } from '@/components/ShuffleButton/ShuffleButton'
import { Summary } from '@/components/Summary/Summary'
import { TmdbCredit } from '@/components/TmdbCredit/TmdbCredit'
import { WatchedCount } from '@/components/WatchedCount/WatchedCount'
import { WatchedToggle } from '@/components/WatchedToggle/WatchedToggle'
import { api } from '@/lib/api'
import { seasonEntryKey } from '@/lib/entryKeys'
import { createdBy, showFacts } from '@/lib/itemFacts'
import { itemPath, watchLink } from '@/lib/itemLinks'
import { POSTER_SIZES, posterSources } from '@/lib/posters'
import { displaySettingsQuery, librariesQuery, nextEpisodeQuery } from '@/lib/queries'
import { ROUTE_STATES, useRouteItem } from '@/lib/routeQuery'
import { useItemFavourite } from '@/lib/useItemFavourite'
import { useSelectable } from '@/lib/useSelectable'
import { useWatchedToggle } from '@/lib/useWatchedChange'
import styles from '@/pages/ShowPage/ShowPage.module.scss'

/** One season in the row: its poster, name and how many episodes are on disk. */
const SeasonCard = ({ season, show }: { season: SeasonSummary; show: ItemDetails }) => {
  const poster = posterSources({ item: season, sizes: POSTER_SIZES.season })
  const to = itemPath(season) ?? `/shows/${show.id}`
  const count = season.episodeCount
  const select = useSelectable({ key: seasonEntryKey(season), title: season.title })
  return (
    <li className={styles.season} data-entry={seasonEntryKey(season)} {...select.rootProps}>
      <SelectCheckbox select={select} className={styles.select} />
      <Link to={to} className={styles.seasonLink} tabIndex={select.linkTabIndex}>
        <span className={styles.seasonPoster}>
          {poster ? (
            <img {...poster} alt="" loading="lazy" decoding="async" />
          ) : (
            <span aria-hidden="true">{season.season ?? ''}</span>
          )}
          <WatchedCount
            watched={season.watchedCount}
            total={season.episodeCount}
            className={styles.seasonWatched}
          />
        </span>
        <span className={styles.seasonText}>
          <span className={styles.seasonTitle}>{season.title}</span>
          <span className={styles.seasonCount}>
            {count} {count === 1 ? 'episode' : 'episodes'}
          </span>
        </span>
      </Link>
    </li>
  )
}

const ShowView = ({ details }: { details: ItemDetails }) => {
  const ids = { title: useId(), seasons: useId() }
  const navigate = useNavigate()
  const [fixing, setFixing] = useState(false)
  const [editingImages, setEditingImages] = useState(false)
  const [editingMetadata, setEditingMetadata] = useState(false)
  const next = useQuery(nextEpisodeQuery(details.id))
  const favourite = useItemFavourite({ item: details })
  // A logo until Settings says to spell titles out, as a fresh install does.
  const showsLogo = useQuery(displaySettingsQuery).data?.titles !== TITLE_DISPLAYS.text
  const libraryId = next.data?.libraryId ?? details.versions[0]?.libraryId
  const libraryName = useQuery(librariesQuery).data?.find((entry) => entry.id === libraryId)?.name
  const code = next.data?.item ? episodeCode(next.data.item) : null
  const seasons = details.children.flatMap((child) =>
    child.type === ITEM_TYPES.season ? [child] : [],
  )
  const episodeCount = seasons.reduce((sum, season) => sum + season.episodeCount, 0)
  const toggle = useWatchedToggle({
    state: watchedStateOf({
      watched: seasons.reduce((sum, season) => sum + season.watchedCount, 0),
      total: episodeCount,
    }),
    targets: [{ kind: 'item', id: details.id, libraryId: null }],
  })

  return (
    <SelectionScope
      {...sourceOf(
        seasons.map((season) => [
          seasonEntryKey(season),
          [{ kind: 'item', id: season.id, libraryId: null }],
        ]),
      )}
    >
      <article className={styles.page} aria-labelledby={ids.title}>
        <ItemHeader
          back={{
            to: libraryId == null ? '/libraries' : `/libraries/${libraryId}`,
            label: libraryName ?? 'Library',
          }}
          titleId={ids.title}
          eyebrow={['Show']}
          title={details.title}
          logo={
            showsLogo
              ? api.itemImageUrl({ id: details.id, kind: 'logo', version: details.logoVersion })
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
              kind: 'poster',
              version: details.posterVersion,
            }),
          }}
          backdrop={pictureBackdrop(
            api.itemImageUrl({
              id: details.id,
              kind: 'backdrop',
              version: details.backdropVersion,
            }),
          )}
          manage={
            <AdminOnly>
              <Button
                icon="edit"
                aria-pressed={editingImages}
                onClick={() => setEditingImages((editing) => !editing)}
              >
                Edit images
              </Button>
              <Button
                icon="edit"
                aria-pressed={editingMetadata}
                onClick={() => setEditingMetadata((editing) => !editing)}
              >
                Edit metadata
              </Button>
              <Button icon="search" onClick={() => setFixing(true)}>
                Fix match
              </Button>
            </AdminOnly>
          }
        >
          {next.data && (
            <ButtonLink tone="primary" icon="play" {...watchLink({ media: next.data })}>
              {code ? `Play ${code}` : 'Play'}
            </ButtonLink>
          )}
          {details.favourite != null && (
            <FavouriteButton isFavourite={details.favourite} onToggle={favourite.mutate} />
          )}
          {episodeCount > 0 && <ShuffleButton itemId={details.id}>Shuffle</ShuffleButton>}
          <WatchedToggle {...toggle} />
          <SelectButton />
        </ItemHeader>

        {details.aiMatch && <AiMatchNote aiMatch={details.aiMatch} />}

        <AdminOnly>
          {editingImages && (
            <ImageEditor
              details={details}
              libraries={[]}
              itemKind="show"
              onDone={() => setEditingImages(false)}
            />
          )}
          {editingMetadata && (
            <MetadataEditor
              details={details}
              itemKind="show"
              onDone={() => setEditingMetadata(false)}
            />
          )}
        </AdminOnly>

        <Summary tagline={details.tagline} summary={details.summary} />

        {seasons.length > 0 && (
          <section className={styles.seasons} aria-labelledby={ids.seasons}>
            <SectionHeading id={ids.seasons}>Seasons</SectionHeading>
            <ul className={styles.seasonRow}>
              {seasons.map((season) => (
                <SeasonCard key={season.id} season={season} show={details} />
              ))}
            </ul>
          </section>
        )}

        <CastRow credits={details.credits} />
        <ReviewCards reviews={details.reviews} />
        <TmdbCredit />

        <SelectionBar />

        <AdminOnly>
          {fixing && (
            <FixMatchDialog
              type="show"
              title={details.title}
              year={details.year}
              libraryId={libraryId}
              subject={{ kind: 'item', id: details.id }}
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

/**
 * `/shows/:id`: a show's backdrop, poster, creator, years, network, scores,
 * Play for the next episode and Shuffle for a random one, then its summary,
 * its seasons as posters in a row, its people and its reviews.
 */
export const ShowPage = () => {
  const page = useRouteItem('show')
  if (page.state !== ROUTE_STATES.ready)
    return <RouteState state={page} noun="show" shape={<ItemHeaderSkeleton picture="poster" />} />
  return <ShowView details={page.data} />
}
