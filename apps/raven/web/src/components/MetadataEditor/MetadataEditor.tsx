import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ITEM_TYPES,
  type ItemDetails,
  type ItemMetadata,
  type ItemMetadataChange,
  type MatchItemType,
  type MediaItem,
} from '@raven/core'
import { type ComponentType, type FormEvent, useId, useState } from 'react'
import { Button, Icon } from '@raven/ui'
import { MovieFiles } from '@/components/MovieFiles/MovieFiles'
import { api } from '@/lib/api'
import { EDITED_PARTS, afterItemEdited } from '@raven/ui/headless'
import { itemMetadataQuery } from '@/lib/queries'
import { METADATA_EDITOR_COPY } from '@/components/MetadataEditor/copy'
import styles from '@/components/MetadataEditor/MetadataEditor.module.scss'
import { COMMON_COPY } from '@/lib/copy'

/** The fields the form writes over, by their key in `ItemMetadata`. */
const FIELD_KEYS = { title: 'title', year: 'year' } as const satisfies {
  [K in keyof ItemMetadata]?: K
}

type Field = (typeof FIELD_KEYS)[keyof typeof FIELD_KEYS]

/** The fields the modal shows as the page does, read only, by their key in `ItemMetadata`. */
const SHOWN_KEYS = {
  contentRating: 'contentRating',
  tagline: 'tagline',
  summary: 'summary',
} as const satisfies { [K in keyof ItemMetadata]?: K }

type ShownField = (typeof SHOWN_KEYS)[keyof typeof SHOWN_KEYS]

/** The box a field is typed in: a line or a number. */
const FIELD_KINDS = { text: 'text', number: 'number' } as const
type FieldKind = (typeof FIELD_KINDS)[keyof typeof FIELD_KINDS]

type FieldSpec = { key: Field; label: string; kind: FieldKind }

const FIELDS = [
  { key: FIELD_KEYS.title, label: COMMON_COPY.title, kind: FIELD_KINDS.text },
  { key: FIELD_KEYS.year, label: COMMON_COPY.year, kind: FIELD_KINDS.number },
] as const satisfies readonly FieldSpec[]

type ShownSpec = { key: ShownField; label: string }

const SHOWN = [
  { key: SHOWN_KEYS.contentRating, label: METADATA_EDITOR_COPY.fields.contentRating },
  { key: SHOWN_KEYS.tagline, label: METADATA_EDITOR_COPY.fields.tagline },
  { key: SHOWN_KEYS.summary, label: METADATA_EDITOR_COPY.fields.summary },
] as const satisfies readonly ShownSpec[]

type FieldBoxProps = { id: string; value: string; onChange: (value: string) => void }

type TextBoxProps = FieldBoxProps

const TextBox = ({ id, value, onChange }: TextBoxProps) => (
  <input id={id} type="text" value={value} onChange={(event) => onChange(event.target.value)} />
)

type NumberBoxProps = FieldBoxProps

const NumberBox = ({ id, value, onChange }: NumberBoxProps) => (
  <input
    id={id}
    type="number"
    inputMode="numeric"
    value={value}
    onChange={(event) => onChange(event.target.value)}
  />
)

const FIELD_BOXES = {
  [FIELD_KINDS.text]: TextBox,
  [FIELD_KINDS.number]: NumberBox,
} as const satisfies Record<FieldKind, ComponentType<FieldBoxProps>>

/** What the form holds: each field as text, so an empty box means "nothing". */
type Draft = Record<Field, string>

const toDraft = (metadata: ItemMetadata): Draft => ({
  title: metadata.title,
  year: metadata.year == null ? '' : String(metadata.year),
})

type ShownFactsProps = { shown: ItemMetadata }

/** The rating, tagline and summary as the page shows them, not changed here. */
const ShownFacts = ({ shown }: ShownFactsProps) => (
  <dl className={styles.shown}>
    {SHOWN.map((field) => (
      <div key={field.key} className={styles.fact}>
        <dt>{field.label}</dt>
        <dd>{shown[field.key] ?? METADATA_EDITOR_COPY.nothing}</dd>
      </div>
    ))}
  </dl>
)

type ValueOfProps = { key: Field; text: string }

/** A draft value as the API takes it; a blank is null, as is a year that is not a number. */
const valueOf = ({ key, text }: ValueOfProps): string | number | null => {
  const trimmed = text.trim()
  if (trimmed === '') return null
  if (key !== FIELD_KEYS.year) return trimmed
  const year = Number.parseInt(trimmed, 10)
  return Number.isInteger(year) ? year : null
}

/** The edition a file name carries, for the wand: the first version that has one. */
const editionFrom = (versions: readonly ItemDetails['versions'][number][]): string | null =>
  versions.find((version) => version.edition != null)?.edition ?? null

type TmdbLineProps = {
  /** What TMDB says, as the form holds it. */
  original: string
  /** What the box holds now. */
  shown: string
  onReset: (original: string) => void
}

/** What TMDB says under a field, and Use TMDB's once the box says otherwise. */
const TmdbLine = ({ original, shown, onReset }: TmdbLineProps) => (
  <p className={styles.original}>
    <span>
      {METADATA_EDITOR_COPY.tmdb(original === '' ? METADATA_EDITOR_COPY.nothing : original)}
    </span>
    {shown.trim() !== original.trim() && (
      <button type="button" className={styles.reset} onClick={() => onReset(original)}>
        {METADATA_EDITOR_COPY.takeTmdbs}
      </button>
    )}
  </p>
)

type MetadataEditorProps = {
  /** The item, its `versions` the files on the card the page is for. */
  details: ItemDetails
  /** A movie's files in the page's library, on every card. */
  everyCard?: readonly MediaItem[]
  itemKind: MatchItemType
  onDone: () => void
}

/**
 * Edit metadata, the body of its modal: a movie's files, which Split apart
 * gives a card each when several share one, then the title and year, each
 * beside what TMDB says, and the rating, tagline and summary the page shows,
 * read only. A title or year written over keeps TMDB's words underneath, and
 * "Use TMDB's" puts them back; a refresh never touches an edit. The wand puts
 * the file name's edition in brackets after the title. Save sends the title
 * and year alone, so the rest keep whatever they show, and closes the modal.
 */
export const MetadataEditor = ({
  details,
  everyCard = details.versions,
  itemKind,
  onDone,
}: MetadataEditorProps) => {
  const formId = useId()
  const queryClient = useQueryClient()
  const state = useQuery(itemMetadataQuery(details.id))
  // What the viewer has typed; until then, what the page shows.
  const [edited, setDraft] = useState<Draft | null>(null)
  const draft = edited ?? (state.data ? toDraft(state.data.shown) : null)

  const save = useMutation({
    mutationFn: (change: ItemMetadataChange) => api.setItemMetadata({ id: details.id, change }),
    // The page takes the answer at once; the listings are read again without holding the editor open.
    onSuccess: (updated) => {
      afterItemEdited({ queryClient, updated, part: EDITED_PARTS.metadata }).catch(() => undefined)
      onDone()
    },
  })

  const edition = itemKind === ITEM_TYPES.movie ? editionFrom(details.versions) : null
  const [first, ...rest] = details.versions
  const original = state.data?.original

  const submit = (event: FormEvent) => {
    event.preventDefault()
    // A blank title would be refused; keep the one shown.
    if (!draft || !original || draft.title.trim() === '') return
    /*
     * A field back at TMDB's words is cleared rather than written over with
     * the same. One emptied where TMDB has words goes as '' (0 for the year),
     * which shows nothing, as null would bring TMDB's back. A field left out
     * of the change keeps what it has, so the rating, tagline and summary are never sent.
     */
    const change = FIELDS.reduce<ItemMetadataChange>((sent, field) => {
      const value = valueOf({ key: field.key, text: draft[field.key] })
      const empty = field.key === FIELD_KEYS.year ? 0 : ''
      return { ...sent, [field.key]: value === original[field.key] ? null : (value ?? empty) }
    }, {})
    save.mutate(change)
  }

  return (
    <>
      {itemKind === ITEM_TYPES.movie && first && (
        <MovieFiles files={[first, ...rest]} everyCard={everyCard} itemId={details.id} />
      )}
      <p className={styles.hint}>{METADATA_EDITOR_COPY.hint}</p>
      {state.isError && (
        <p className={styles.error} role="alert">
          <Icon name="alert" size={16} />
          {state.error.message}
        </p>
      )}
      {save.isError && (
        <p className={styles.error} role="alert">
          <Icon name="alert" size={16} />
          <span>{METADATA_EDITOR_COPY.couldNotSave(save.error.message)}</span>
        </p>
      )}
      {draft && original && (
        <form id={formId} className={styles.form} onSubmit={submit}>
          {FIELDS.map((field) => {
            const id = `${formId}-${field.key}`
            const FieldBox = FIELD_BOXES[field.kind]
            const wandEdition = field.key === FIELD_KEYS.title ? edition : null
            return (
              <div key={field.key} className={styles.field}>
                <label htmlFor={id}>{field.label}</label>
                <div className={wandEdition ? styles.withWand : styles.control}>
                  <FieldBox
                    id={id}
                    value={draft[field.key]}
                    onChange={(value) => setDraft({ ...draft, [field.key]: value })}
                  />
                  {wandEdition && (
                    <Button
                      icon="wand"
                      aria-label={METADATA_EDITOR_COPY.addEdition(wandEdition)}
                      title={METADATA_EDITOR_COPY.titleItAs(
                        METADATA_EDITOR_COPY.editionTitle({
                          title: original.title,
                          edition: wandEdition,
                        }),
                      )}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          title: METADATA_EDITOR_COPY.editionTitle({
                            title: original.title,
                            edition: wandEdition,
                          }),
                        })
                      }
                    />
                  )}
                </div>
                <TmdbLine
                  original={toDraft(original)[field.key]}
                  shown={draft[field.key]}
                  onReset={(text) => setDraft({ ...draft, [field.key]: text })}
                />
              </div>
            )
          })}
          {state.data && <ShownFacts shown={state.data.shown} />}
          <div className={styles.actions}>
            <Button tone="primary" type="submit" disabled={save.isPending}>
              {METADATA_EDITOR_COPY.save}
            </Button>
          </div>
        </form>
      )}
      {state.isPending && !state.isError && (
        <p className={styles.hint}>{METADATA_EDITOR_COPY.reading}</p>
      )}
    </>
  )
}
