import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ApiError,
  type ItemDetails,
  type MediaItem,
  type MediaTracks,
  codecLabel,
  formatChannels,
  formatDuration,
  formatRuntime,
  resolutionLabel,
} from '@raven/core'
import { useId, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, ButtonLink } from '@/components/Button/Button'
import { CastRow } from '@/components/CastRow/CastRow'
import { ItemHeader } from '@/components/ItemHeader/ItemHeader'
import { MediaMenu } from '@/components/MediaMenu/MediaMenu'
import { TmdbCredit } from '@/components/TmdbCredit/TmdbCredit'
import { Versions } from '@/components/Versions/Versions'
import { api } from '@/lib/api'
import { itemPath } from '@/lib/itemLinks'
import { queryKeys } from '@/lib/queryClient'
import { languageName } from '@/lib/trackLabels'
import { useMediaMutations } from '@/lib/useMediaMutations'
import { NotFoundPage } from '@/pages/NotFoundPage/NotFoundPage'
import styles from '@/pages/MoviePage/MoviePage.module.scss'

/** A summary longer than this gets clamped to three lines with More. */
const LONG_SUMMARY = 240

/** "A", "A and B", "A, B and C". */
export const joinNames = (names: readonly string[]): string =>
  names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`

const unique = (values: readonly string[]): string[] =>
  values.filter((value, index) => values.indexOf(value) === index)

/** "Directed by Lana Wachowski and Lilly Wachowski", or null without a director. */
export const directedBy = (details: ItemDetails): string | null => {
  const directors = unique(
    details.credits.filter((credit) => credit.job === 'director').map((credit) => credit.name),
  )
  return directors.length > 0 ? `Directed by ${joinNames(directors)}` : null
}

/** Year, runtime (the file's own length when probed, else TMDB's) and up to three genres. */
export const movieFacts = ({
  details,
  primary,
}: {
  details: ItemDetails
  primary: MediaItem | undefined
}): string[] =>
  [
    details.year == null ? null : String(details.year),
    formatRuntime(primary?.duration ?? null) ??
      (details.runtime == null ? null : formatRuntime(details.runtime * 60)),
    ...details.genres.slice(0, 3),
  ].filter((fact): fact is string => fact != null)

/** The file's video, audio and subtitles, as the tracks the scan stored describe them. */
export const fileFacts = ({
  media,
  tracks,
}: {
  media: MediaItem
  tracks: MediaTracks | undefined
}): Array<{ label: string; value: string }> => {
  const resolution = resolutionLabel(media)
  const codec = media.videoCodec ? codecLabel(media.videoCodec) : null
  const video = [resolution, codec == null ? null : `(${codec})`, media.hdr ? 'HDR' : null]
    .filter((part): part is string => part != null)
    .join(' ')
  const audioTrack =
    tracks?.audio.find((track) => track.index === tracks.defaultAudio) ?? tracks?.audio[0]
  const audioCodec = audioTrack?.codec ?? media.audioCodec
  const audioDetails = [
    audioCodec == null ? null : codecLabel(audioCodec),
    formatChannels(audioTrack?.channels ?? media.audioChannels),
  ].filter((part): part is string => part != null)
  const language = languageName(audioTrack?.language ?? null)
  // "English (EAC3 5.1)", or just the details when the track names no language.
  const audio =
    language == null
      ? audioDetails.join(' ')
      : [language, audioDetails.length > 0 ? `(${audioDetails.join(' ')})` : null]
          .filter((part): part is string => part != null)
          .join(' ')
  const subtitles = unique(
    (tracks?.subtitles ?? []).flatMap((track) => languageName(track.language) ?? []),
  ).join(', ')
  return [
    { label: 'Video', value: video },
    { label: 'Audio', value: audio },
    { label: 'Subtitles', value: subtitles },
  ].filter((fact) => fact.value !== '')
}

const Summary = ({ details }: { details: ItemDetails }) => {
  const id = useId()
  const [expanded, setExpanded] = useState(false)
  const summary = details.summary ?? ''
  const long = summary.length > LONG_SUMMARY
  if (!details.tagline && !summary) return null
  return (
    <section className={styles.summary} aria-label="Summary">
      {details.tagline && <p className={styles.tagline}>{details.tagline}</p>}
      {summary && (
        <p id={id} className={long && !expanded ? `${styles.text} ${styles.clamped}` : styles.text}>
          {summary}
        </p>
      )}
      {long && (
        <Button
          className={styles.more}
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? 'Less' : 'More'}
        </Button>
      )}
    </section>
  )
}

/** The page once the movie and its best file are known. */
const MovieView = ({ details, primary }: { details: ItemDetails; primary: MediaItem }) => {
  const ids = { title: useId(), file: useId() }
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [menuOpen, setMenuOpen] = useState(false)
  const { favourite } = useMediaMutations({ media: primary })
  const libraries = useQuery({ queryKey: queryKeys.libraries, queryFn: api.listLibraries })
  const tracks = useQuery({
    queryKey: queryKeys.mediaTracks(primary.id),
    queryFn: () => api.getTracks(primary.id),
  })
  const library = libraries.data?.find((entry) => entry.id === primary.libraryId)
  const facts = fileFacts({ media: primary, tracks: tracks.data })
  const tmdb = details.ratings.filter((rating) => rating.source === 'tmdb')

  return (
    <article className={styles.page} aria-labelledby={ids.title}>
      <ButtonLink to={`/libraries/${primary.libraryId}`} icon="back" className={styles.back}>
        {library?.name ?? 'Library'}
      </ButtonLink>

      <ItemHeader
        titleId={ids.title}
        title={details.title}
        byline={directedBy(details)}
        contentRating={details.contentRating}
        facts={movieFacts({ details, primary })}
        ratings={tmdb}
        poster={api.itemImageUrl({
          id: details.id,
          kind: 'poster',
          version: details.posterVersion,
        })}
        backdrop={api.itemImageUrl({
          id: details.id,
          kind: 'backdrop',
          version: details.backdropVersion,
        })}
      >
        <ButtonLink
          tone="primary"
          icon="play"
          to={`/watch/${primary.id}`}
          state={{ media: primary }}
        >
          {primary.position > 0 ? `Resume from ${formatDuration(primary.position)}` : 'Play'}
        </ButtonLink>
        <Button
          icon="heart"
          aria-label="Favourite"
          aria-pressed={primary.favourite}
          className={primary.favourite ? styles.favourited : undefined}
          disabled={favourite.isPending}
          onClick={() => favourite.mutate(!primary.favourite)}
        />
        <MediaMenu
          media={primary}
          open={menuOpen}
          onOpenChange={setMenuOpen}
          inline
          matchType="movie"
          withFavourite={false}
          onMatched={(updated) => {
            const page = updated.item ? itemPath(updated.item) : null
            navigate(page ?? `/libraries/${updated.libraryId}`, { replace: true })
          }}
          onDeleted={() => {
            if (details.versions.length <= 1) navigate(`/libraries/${primary.libraryId}`)
            else void queryClient.invalidateQueries({ queryKey: queryKeys.item(details.id) })
          }}
        />
      </ItemHeader>

      <Summary details={details} />

      {facts.length > 0 && (
        <section className={styles.file} aria-labelledby={ids.file}>
          <h2 id={ids.file} className="visually-hidden">
            File
          </h2>
          <dl className={styles.facts}>
            {facts.map((fact) => (
              <div key={fact.label} className={styles.fact}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <Versions versions={details.versions} libraries={libraries.data ?? []} />
      <CastRow credits={details.credits} />
      <TmdbCredit />
    </article>
  )
}

/** `/movies/:id`: a movie's backdrop, poster, facts, scores, summary, files and people. */
export const MoviePage = () => {
  const params = useParams()
  const id = Number(params.id)
  const item = useQuery({
    queryKey: queryKeys.item(id),
    queryFn: () => api.getItem(id),
    enabled: Number.isInteger(id),
  })

  const missing = item.error instanceof ApiError && item.error.status === 404
  if (!Number.isInteger(id) || missing) return <NotFoundPage />
  if (item.isError) {
    return (
      <p className={styles.message} role="alert">
        {item.error.message}
      </p>
    )
  }
  if (!item.data) return <p className={styles.message}>Opening the movie</p>

  // A saved spot wins, so Play resumes where the viewer stopped, in whichever version.
  const primary =
    item.data.versions.find((version) => version.position > 0) ?? item.data.versions[0]
  if (!primary) return <NotFoundPage />
  return <MovieView details={item.data} primary={primary} />
}
