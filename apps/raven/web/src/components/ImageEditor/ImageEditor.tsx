import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  type ImageChoice,
  type ImageOption,
  type ItemDetails,
  type Library,
  codecLabel,
  formatBytes,
  resolutionLabel,
} from '@raven/core'
import { useId } from 'react'
import { Button } from '@/components/Button/Button'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/queryClient'
import styles from '@/components/ImageEditor/ImageEditor.module.scss'

type Kind = 'poster' | 'backdrop'

const KIND_LABELS: Record<Kind, string> = { poster: 'Poster', backdrop: 'Backdrop' }

const LANGUAGE_NAMES = new Intl.DisplayNames(['en'], { type: 'language' })

const languageName = (code: string | null): string => {
  if (code == null) return 'No text'
  try {
    return LANGUAGE_NAMES.of(code) ?? code
  } catch {
    return code
  }
}

/** What a picture is, for its label: where it comes from, its size and its language. */
const describe = (option: ImageOption): string =>
  [
    option.source === 'local' ? 'Beside the files' : 'TMDB',
    option.width != null && option.height != null ? `${option.width} by ${option.height}` : null,
    option.source === 'local' ? null : languageName(option.language),
  ]
    .filter((part): part is string => part != null)
    .join(', ')

const choiceOf = (option: ImageOption): ImageChoice =>
  option.source === 'local' ? { source: 'local' } : { source: 'tmdb', ref: option.ref }

const Options = ({
  itemId,
  kind,
  options,
  busy,
  onChoose,
}: {
  itemId: number
  kind: Kind
  options: readonly ImageOption[]
  busy: boolean
  onChoose: (option: ImageOption) => void
}) => {
  const id = useId()
  return (
    <section className={styles.group} aria-labelledby={id}>
      <h3 id={id} className={styles.groupHeading}>
        {KIND_LABELS[kind]}
      </h3>
      {options.length === 0 ? (
        <p className={styles.hint}>No {kind}s to choose from.</p>
      ) : (
        <ul className={kind === 'poster' ? styles.posters : styles.backdrops}>
          {options.map((option) => (
            <li key={`${option.source}:${option.ref}`}>
              <button
                type="button"
                className={styles.option}
                aria-pressed={option.current}
                aria-label={`${KIND_LABELS[kind]}: ${describe(option)}`}
                disabled={busy || option.current}
                onClick={() => onChoose(option)}
              >
                <img
                  src={api.imageOptionUrl({ id: itemId, kind, option })}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
                <span className={styles.caption}>{describe(option)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * Edit images: every poster and backdrop a movie could show, the current
 * one marked, and the files that are this movie, since they share them.
 */
export const ImageEditor = ({
  details,
  libraries,
  onDone,
}: {
  details: ItemDetails
  libraries: readonly Library[]
  onDone: () => void
}) => {
  const ids = { heading: useId(), versions: useId() }
  const queryClient = useQueryClient()
  const options = useQuery({
    queryKey: queryKeys.itemImages(details.id),
    queryFn: () => api.getItemImages(details.id),
  })
  const choose = useMutation({
    mutationFn: ({ kind, option }: { kind: Kind; option: ImageOption }) =>
      api.chooseItemImage({ id: details.id, kind, choice: choiceOf(option) }),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.item(details.id), updated)
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.itemImages(details.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.libraries }),
      ])
    },
  })
  const libraryName = (libraryId: number) =>
    libraries.find((library) => library.id === libraryId)?.name ?? ''

  return (
    <section className={styles.editor} aria-labelledby={ids.heading}>
      <header className={styles.header}>
        <h2 id={ids.heading} className={styles.heading}>
          Edit images
        </h2>
        <Button icon="close" onClick={onDone}>
          Done
        </Button>
      </header>

      <section className={styles.group} aria-labelledby={ids.versions}>
        <h3 id={ids.versions} className={styles.groupHeading}>
          {details.versions.length === 1 ? 'This file' : 'Linked files'}
        </h3>
        <p className={styles.hint}>
          {details.versions.length === 1
            ? 'The pictures below are the movie’s, so a second version of it would share them.'
            : 'These files are the same movie and share the pictures below; each plays on its own.'}
        </p>
        <ul className={styles.versions}>
          {details.versions.map((version) => {
            const facts = [
              version.edition ?? 'Standard',
              resolutionLabel(version),
              version.hdr ? 'HDR' : null,
              version.videoCodec ? codecLabel(version.videoCodec) : null,
              formatBytes(version.size),
              libraryName(version.libraryId),
            ].filter((fact): fact is string => fact != null && fact !== '')
            return (
              <li key={version.id} className={styles.version}>
                <span className={styles.facts}>
                  {facts.map((fact) => (
                    <span key={fact}>{fact}</span>
                  ))}
                </span>
                <span className={styles.file}>{version.fileName}</span>
              </li>
            )
          })}
        </ul>
      </section>

      {options.isError && (
        <p className={styles.error} role="alert">
          {options.error.message}
        </p>
      )}
      {choose.isError && (
        <p className={styles.error} role="alert">
          Could not change the picture: {choose.error.message}
        </p>
      )}
      {options.isPending && !options.isError && (
        <p className={styles.hint}>Asking TMDB for pictures</p>
      )}
      {options.data && (
        <>
          <Options
            itemId={details.id}
            kind="poster"
            options={options.data.poster}
            busy={choose.isPending}
            onChoose={(option) => choose.mutate({ kind: 'poster', option })}
          />
          <Options
            itemId={details.id}
            kind="backdrop"
            options={options.data.backdrop}
            busy={choose.isPending}
            onChoose={(option) => choose.mutate({ kind: 'backdrop', option })}
          />
        </>
      )}
    </section>
  )
}
