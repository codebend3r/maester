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
import { type ComponentType, useId, useState } from 'react'
import { Button, Icon } from '@raven/ui'
import { LogoImage } from '@/components/LogoImage/LogoImage'
import { Tabs } from '@/components/Tabs/Tabs'
import { api } from '@/lib/api'
import { EDITED_PARTS, afterItemEdited } from '@raven/ui/headless'
import { itemImagesQuery } from '@/lib/queries'
import { WordFact } from '@/components/ResolutionChip/ResolutionChip'
import { IMAGE_EDITOR_COPY } from '@/components/ImageEditor/copy'
import styles from '@/components/ImageEditor/ImageEditor.module.scss'
import { COMMON_COPY } from '@/lib/copy'

const KIND_LABELS: Record<ChoosableImageKind, string> = IMAGE_EDITOR_COPY.kinds

/** What a picture is, for its label: where it comes from, its size and its language. */
const describe = (option: ImageOption): string =>
  [
    option.source === IMAGE_SOURCES.local ? IMAGE_EDITOR_COPY.besideFiles : COMMON_COPY.tmdb,
    option.width != null && option.height != null
      ? IMAGE_EDITOR_COPY.size({ width: option.width, height: option.height })
      : null,
    option.source === IMAGE_SOURCES.local
      ? null
      : (languageName({ tag: option.language, fallback: LANGUAGE_FALLBACKS.original }) ??
        IMAGE_EDITOR_COPY.noText),
  ]
    .filter((part): part is string => part != null)
    .join(COMMON_COPY.listSeparator)

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

/** A logo is drawn by its own component, so it can be recoloured; the rest are plain pictures. */
const OPTION_PICTURES = { logo: 'logo', plain: 'plain' } as const

type OptionPicture = (typeof OPTION_PICTURES)[keyof typeof OPTION_PICTURES]

type OptionImageProps = { src: string }

type LogoOptionProps = OptionImageProps

const LogoOption = ({ src }: LogoOptionProps) => <LogoImage src={src} alt="" loading="lazy" />

type PlainOptionProps = OptionImageProps

const PlainOption = ({ src }: PlainOptionProps) => (
  <img src={src} alt="" loading="lazy" decoding="async" />
)

const OPTION_PICTURE_VIEWS = {
  [OPTION_PICTURES.logo]: LogoOption,
  [OPTION_PICTURES.plain]: PlainOption,
} as const satisfies Record<OptionPicture, ComponentType<OptionImageProps>>

type OptionsProps = {
  itemId: number
  kind: ChoosableImageKind
  options: readonly ImageOption[]
  busy: boolean
  onChoose: (option: ImageOption) => void
}

/** A tab with no pictures to pick from, or the pictures to pick from. */
const OPTION_LISTS = { empty: 'empty', listed: 'listed' } as const

type OptionList = (typeof OPTION_LISTS)[keyof typeof OPTION_LISTS]

type NoOptionsProps = OptionsProps

const NoOptions = ({ kind }: NoOptionsProps) => (
  <p className={styles.hint}>{IMAGE_EDITOR_COPY.noOptions(kind)}</p>
)

type OptionGridProps = OptionsProps

const OptionGrid = ({ itemId, kind, options, busy, onChoose }: OptionGridProps) => {
  const Picture =
    OPTION_PICTURE_VIEWS[
      kind === ITEM_IMAGE_KINDS.logo ? OPTION_PICTURES.logo : OPTION_PICTURES.plain
    ]
  return (
    <ul className={GRIDS[kind]}>
      {options.map((option) => (
        <li key={`${option.source}:${option.ref}`}>
          <button
            type="button"
            className={styles.option}
            aria-pressed={option.current}
            aria-label={IMAGE_EDITOR_COPY.optionLabel({
              kind: KIND_LABELS[kind],
              description: describe(option),
            })}
            disabled={busy || option.current}
            onClick={() => onChoose(option)}
          >
            <Picture src={api.imageOptionUrl({ id: itemId, kind, option })} />
            <span className={styles.caption}>{describe(option)}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

const OPTION_LIST_VIEWS = {
  [OPTION_LISTS.empty]: NoOptions,
  [OPTION_LISTS.listed]: OptionGrid,
} as const satisfies Record<OptionList, ComponentType<OptionsProps>>

/** One tab's pictures to pick from. */
const Options = (props: OptionsProps) => {
  const List =
    OPTION_LIST_VIEWS[props.options.length === 0 ? OPTION_LISTS.empty : OPTION_LISTS.listed]
  return <List {...props} />
}

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
          <label htmlFor={ids.library}>{IMAGE_EDITOR_COPY.picturesFor}</label>
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
                {libraryName(holder) ?? IMAGE_EDITOR_COPY.library(holder)}
              </option>
            ))}
          </select>
          <p className={styles.hint}>{IMAGE_EDITOR_COPY.ownPictures}</p>
        </div>
      )}

      {itemKind === ITEM_TYPES.movie && shownVersions.length > 0 && (
        <section className={styles.group} aria-labelledby={ids.versions}>
          <h3 id={ids.versions} className={styles.groupHeading}>
            {shownVersions.length === 1
              ? IMAGE_EDITOR_COPY.thisFile
              : IMAGE_EDITOR_COPY.linkedFiles}
          </h3>
          <p className={styles.hint}>
            {shownVersions.length === 1
              ? IMAGE_EDITOR_COPY.thisFileHint
              : IMAGE_EDITOR_COPY.linkedFilesHint}
          </p>
          <ul className={styles.versions}>
            {shownVersions.map((version) => {
              const edition = version.edition ?? IMAGE_EDITOR_COPY.standardEdition
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
          <span>{IMAGE_EDITOR_COPY.couldNotChange(choose.error.message)}</span>
        </p>
      )}
      {options.isPending && !options.isError && (
        <p className={styles.hint}>{IMAGE_EDITOR_COPY.asking}</p>
      )}
      {options.data && (
        <section className={styles.group}>
          <Tabs
            label={IMAGE_EDITOR_COPY.pictures}
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
  itemKind = ITEM_TYPES.movie,
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
          {COMMON_COPY.editImages}
        </h2>
        <Button icon="close" onClick={onDone}>
          {IMAGE_EDITOR_COPY.done}
        </Button>
      </header>

      {shownIn == null && <p className={styles.hint}>{IMAGE_EDITOR_COPY.noLibrary}</p>}
      {shownIn != null && (
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
