import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  type ChoosableImageKind,
  IMAGE_SOURCES,
  ITEM_IMAGE_KINDS,
  ITEM_TYPES,
  type ImageChoice,
  type ImageOption,
  type ItemDetails,
  LANGUAGE_FALLBACKS,
  type Library,
  type MatchItemType,
  languageName,
  versionFacts,
} from '@raven/core'
import { useId, useState } from 'react'
import { Button, Icon } from '@raven/ui'
import { LogoImage } from '@/components/LogoImage/LogoImage'
import { Tabs } from '@/components/Tabs/Tabs'
import { api } from '@/lib/api'
import { EDITED_PARTS, afterItemEdited } from '@raven/ui/headless'
import { itemImagesQuery } from '@/lib/queries'
import { WordFact } from '@/components/ResolutionChip/ResolutionChip'
import styles from '@/components/ImageEditor/ImageEditor.module.scss'

const KIND_LABELS: Record<ChoosableImageKind, string> = {
  poster: 'Poster',
  backdrop: 'Backdrop',
  logo: 'Logo',
}

/** What a picture is, for its label: where it comes from, its size and its language. */
const describe = (option: ImageOption): string =>
  [
    option.source === IMAGE_SOURCES.local ? 'Beside the files' : 'TMDB',
    option.width != null && option.height != null ? `${option.width} by ${option.height}` : null,
    option.source === IMAGE_SOURCES.local
      ? null
      : (languageName({ tag: option.language, fallback: LANGUAGE_FALLBACKS.original }) ??
        'No text'),
  ]
    .filter((part): part is string => part != null)
    .join(', ')

const choiceOf = (option: ImageOption): ImageChoice =>
  option.source === IMAGE_SOURCES.local
    ? { source: IMAGE_SOURCES.local }
    : { source: IMAGE_SOURCES.tmdb, ref: option.ref }

/** A movie and a show each choose a poster, a backdrop and a logo. */
const KINDS_OF: Record<MatchItemType, readonly ChoosableImageKind[]> = {
  movie: ['poster', 'backdrop', 'logo'],
  show: ['poster', 'backdrop', 'logo'],
}

const GRIDS: Record<ChoosableImageKind, string | undefined> = {
  poster: styles.posters,
  backdrop: styles.backdrops,
  logo: styles.logos,
}

type OptionsProps = {
  itemId: number
  kind: ChoosableImageKind
  options: readonly ImageOption[]
  busy: boolean
  onChoose: (option: ImageOption) => void
}

/** One tab's pictures to pick from. */
const Options = ({ itemId, kind, options, busy, onChoose }: OptionsProps) => (
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
              {kind === ITEM_IMAGE_KINDS.logo ? (
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

type ImageEditorProps = {
  details: ItemDetails
  libraries: readonly Library[]
  /** The library the editor was opened from, whose pictures it starts on; null for none. */
  libraryId: number | null
  /** A show's pictures are its own; there are no linked files to list. */
  itemKind?: MatchItemType
  onDone: () => void
}

type LibraryImagesProps = {
  details: ItemDetails
  itemKind: MatchItemType
  /** The library whose cards' pictures are being chosen. */
  libraryId: number
  /** Every library holding the title that the viewer sees, to pick among. */
  holders: readonly number[]
  onPick: (libraryId: number) => void
  libraryName: (libraryId: number) => string | null
}

/** Edit images for one library: which library, its files of this movie, and the pictures to choose from. */
const LibraryImages = ({
  details,
  itemKind,
  libraryId,
  holders,
  onPick,
  libraryName,
}: LibraryImagesProps) => {
  const ids = { versions: useId(), library: useId() }
  const [tab, setTab] = useState<ChoosableImageKind>('poster')
  const kinds = KINDS_OF[itemKind]
  const queryClient = useQueryClient()
  const options = useQuery(itemImagesQuery({ id: details.id, libraryId }))
  type ChooseMutationFnProps = { kind: ChoosableImageKind; option: ImageOption }

  const choose = useMutation({
    mutationFn: ({ kind, option }: ChooseMutationFnProps) =>
      api.chooseItemImage({ id: details.id, kind, libraryId, choice: choiceOf(option) }),
    onSuccess: (updated) => afterItemEdited({ queryClient, updated, part: EDITED_PARTS.images }),
  })
  const shownVersions = details.versions.filter((version) => version.libraryId === libraryId)

  return (
    <>
      {holders.length > 1 && (
        <div className={styles.library}>
          <label htmlFor={ids.library}>Pictures for</label>
          <select
            id={ids.library}
            value={libraryId}
            onChange={(event) => {
              const chosen = holders.find((holder) => String(holder) === event.target.value)
              if (chosen != null) onPick(chosen)
            }}
          >
            {holders.map((holder) => (
              <option key={holder} value={holder}>
                {libraryName(holder) ?? `Library ${holder}`}
              </option>
            ))}
          </select>
          <p className={styles.hint}>
            Each library chooses its own; the others keep the pictures they show.
          </p>
        </div>
      )}

      {itemKind === ITEM_TYPES.movie && shownVersions.length > 0 && (
        <section className={styles.group} aria-labelledby={ids.versions}>
          <h3 id={ids.versions} className={styles.groupHeading}>
            {shownVersions.length === 1 ? 'This file' : 'Linked files'}
          </h3>
          <p className={styles.hint}>
            {shownVersions.length === 1
              ? 'The pictures below are this library’s, so a second version of it here would share them.'
              : 'These files are the same movie in this library and share the pictures below; each plays on its own.'}
          </p>
          <ul className={styles.versions}>
            {shownVersions.map((version) => {
              const edition = version.edition ?? 'Standard'
              const library = libraryName(version.libraryId)
              return (
                <li key={version.id} className={styles.version}>
                  <span className={styles.facts}>
                    {edition !== '' && <span>{edition}</span>}
                    {versionFacts(version).map((fact) => (
                      <span key={fact}>
                        <WordFact fact={fact} />
                      </span>
                    ))}
                    {library != null && <span>{library}</span>}
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
          <Tabs
            label="Pictures"
            tabs={kinds.map((kind) => ({
              value: kind,
              label: KIND_LABELS[kind],
              count: options.data[kind].length,
            }))}
            chosen={tab}
            onChoose={setTab}
          >
            <Options
              itemId={details.id}
              kind={tab}
              options={options.data[tab]}
              busy={choose.isPending}
              onChoose={(option) => choose.mutate({ kind: tab, option })}
            />
          </Tabs>
        </section>
      )}
    </>
  )
}

/**
 * Edit images: every poster, backdrop and logo a movie or show could show,
 * the one its library shows marked, and that library's files of this movie,
 * since they share them. Each library holding the title chooses its own, so
 * a title held by several asks which one, starting on the one it was opened
 * from. A choice takes at once, so the panel has no Save, only Done at its top.
 */
export const ImageEditor = ({
  details,
  libraries,
  libraryId,
  itemKind = 'movie',
  onDone,
}: ImageEditorProps) => {
  const headingId = useId()
  const holders = (details.libraryPictures ?? []).map((pictures) => pictures.libraryId)
  const [picked, setPicked] = useState<number | null>(null)
  const opened = libraryId != null && holders.includes(libraryId) ? libraryId : null
  const shownIn = picked ?? opened ?? holders[0] ?? null
  const libraryName = (id: number) => libraries.find((library) => library.id === id)?.name ?? null

  return (
    <section className={styles.editor} aria-labelledby={headingId}>
      <header className={styles.header}>
        <h2 id={headingId} className={styles.heading}>
          Edit images
        </h2>
        <Button icon="close" onClick={onDone}>
          Done
        </Button>
      </header>

      {shownIn == null ? (
        <p className={styles.hint}>
          No library you can see holds this title, so it has no pictures to choose.
        </p>
      ) : (
        <LibraryImages
          details={details}
          itemKind={itemKind}
          libraryId={shownIn}
          holders={holders}
          onPick={setPicked}
          libraryName={libraryName}
        />
      )}
    </section>
  )
}
