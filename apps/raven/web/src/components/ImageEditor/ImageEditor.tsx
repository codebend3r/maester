import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  type ChoosableImageKind,
  languageName,
  type ImageChoice,
  type ImageOption,
  type ItemDetails,
  type Library,
  type MatchItemType,
} from '@raven/core'
import { useId, useState } from 'react'
import { Button, Icon } from '@raven/ui'
import { LogoImage } from '@/components/LogoImage/LogoImage'
import { api } from '@/lib/api'
import { afterItemEdited } from '@/lib/invalidate'
import { versionFacts } from '@/lib/itemFacts'
import { itemImagesQuery } from '@/lib/queries'
import styles from '@/components/ImageEditor/ImageEditor.module.scss'

const KIND_LABELS: Record<ChoosableImageKind, string> = {
  poster: 'Poster',
  backdrop: 'Backdrop',
  logo: 'Logo',
}

/** What a picture is, for its label: where it comes from, its size and its language. */
const describe = (option: ImageOption): string =>
  [
    option.source === 'local' ? 'Beside the files' : 'TMDB',
    option.width != null && option.height != null ? `${option.width} by ${option.height}` : null,
    option.source === 'local'
      ? null
      : (languageName({ tag: option.language, fallback: 'original' }) ?? 'No text'),
  ]
    .filter((part): part is string => part != null)
    .join(', ')

const choiceOf = (option: ImageOption): ImageChoice =>
  option.source === 'local' ? { source: 'local' } : { source: 'tmdb', ref: option.ref }

/** A movie's pictures include its logo; a show's page shows none, so it has no logo to choose. */
const KINDS_OF: Record<MatchItemType, readonly ChoosableImageKind[]> = {
  movie: ['poster', 'backdrop', 'logo'],
  show: ['poster', 'backdrop'],
}

const GRIDS: Record<ChoosableImageKind, string | undefined> = {
  poster: styles.posters,
  backdrop: styles.backdrops,
  logo: styles.logos,
}

/** One tab's pictures to pick from. */
const Options = ({
  itemId,
  kind,
  options,
  busy,
  onChoose,
}: {
  itemId: number
  kind: ChoosableImageKind
  options: readonly ImageOption[]
  busy: boolean
  onChoose: (option: ImageOption) => void
}) => (
  <>
    {options.length === 0 ? (
      <p className={styles.hint}>No {kind}s to choose from.</p>
    ) : (
      <ul className={GRIDS[kind]}>
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
              {kind === 'logo' ? (
                <LogoImage
                  src={api.imageOptionUrl({ id: itemId, kind, option })}
                  alt=""
                  loading="lazy"
                />
              ) : (
                <img
                  src={api.imageOptionUrl({ id: itemId, kind, option })}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
              )}
              <span className={styles.caption}>{describe(option)}</span>
            </button>
          </li>
        ))}
      </ul>
    )}
  </>
)

/**
 * Edit images: every poster, backdrop and logo a movie could show (a show
 * has no logo), the current one marked, and the files that are this movie,
 * since they share them. A choice takes at once, so the panel has no Save,
 * only Done at its top.
 */
export const ImageEditor = ({
  details,
  libraries,
  itemKind = 'movie',
  onDone,
}: {
  details: ItemDetails
  libraries: readonly Library[]
  /** A show's pictures are its own; there are no linked files to list. */
  itemKind?: MatchItemType
  onDone: () => void
}) => {
  const ids = { heading: useId(), versions: useId(), tabs: useId() }
  const [tab, setTab] = useState<ChoosableImageKind>('poster')
  const kinds = KINDS_OF[itemKind]
  const queryClient = useQueryClient()
  const options = useQuery(itemImagesQuery(details.id))
  const choose = useMutation({
    mutationFn: ({ kind, option }: { kind: ChoosableImageKind; option: ImageOption }) =>
      api.chooseItemImage({ id: details.id, kind, choice: choiceOf(option) }),
    onSuccess: (updated) => afterItemEdited({ queryClient, updated, part: 'images' }),
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

      {itemKind === 'movie' && (
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
                ...versionFacts(version),
                libraryName(version.libraryId),
              ].filter((fact) => fact !== '')
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
      )}

      {options.isError && (
        <p className={styles.error} role="alert">
          <Icon name="alert" size={16} />
          {options.error.message}
        </p>
      )}
      {choose.isError && (
        <p className={styles.error} role="alert">
          <Icon name="alert" size={16} />
          <span>Could not change the picture: {choose.error.message}</span>
        </p>
      )}
      {options.isPending && !options.isError && (
        <p className={styles.hint}>Asking TMDB for pictures</p>
      )}
      {options.data && (
        <section className={styles.group}>
          <div role="tablist" aria-label="Pictures" className={styles.tabs}>
            {kinds.map((kind) => (
              <button
                key={kind}
                type="button"
                role="tab"
                id={`${ids.tabs}-${kind}`}
                aria-selected={tab === kind}
                aria-controls={`${ids.tabs}-${kind}-panel`}
                tabIndex={tab === kind ? 0 : -1}
                className={styles.tab}
                onClick={() => setTab(kind)}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
                  event.preventDefault()
                  const step = event.key === 'ArrowRight' ? 1 : kinds.length - 1
                  const next = kinds[(kinds.indexOf(kind) + step) % kinds.length] ?? kind
                  setTab(next)
                  document.getElementById(`${ids.tabs}-${next}`)?.focus()
                }}
              >
                {KIND_LABELS[kind]}
                <span className={styles.tabCount}>{options.data[kind].length}</span>
              </button>
            ))}
          </div>
          <div
            role="tabpanel"
            id={`${ids.tabs}-${tab}-panel`}
            aria-labelledby={`${ids.tabs}-${tab}`}
            className={styles.panel}
          >
            <Options
              itemId={details.id}
              kind={tab}
              options={options.data[tab]}
              busy={choose.isPending}
              onChoose={(option) => choose.mutate({ kind: tab, option })}
            />
          </div>
        </section>
      )}
    </section>
  )
}
