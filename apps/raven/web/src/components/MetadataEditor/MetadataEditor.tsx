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

type Field = keyof ItemMetadata

/** Each field the form edits, by its key in `ItemMetadata`. */
const FIELD_KEYS = {
  title: 'title',
  year: 'year',
  contentRating: 'contentRating',
  tagline: 'tagline',
  summary: 'summary',
} as const satisfies { [K in Field]: K }

/** The box a field is typed in: a line, a number, or several lines. */
const FIELD_KINDS = { text: 'text', number: 'number', long: 'long' } as const
type FieldKind = (typeof FIELD_KINDS)[keyof typeof FIELD_KINDS]

const FIELDS: readonly {
  key: Field
  label: string
  kind: FieldKind
}[] = [
  { key: FIELD_KEYS.title, label: COMMON_COPY.title, kind: FIELD_KINDS.text },
  { key: FIELD_KEYS.year, label: COMMON_COPY.year, kind: FIELD_KINDS.number },
  {
    key: FIELD_KEYS.contentRating,
    label: METADATA_EDITOR_COPY.fields.contentRating,
    kind: FIELD_KINDS.text,
  },
  { key: FIELD_KEYS.tagline, label: METADATA_EDITOR_COPY.fields.tagline, kind: FIELD_KINDS.text },
  { key: FIELD_KEYS.summary, label: METADATA_EDITOR_COPY.fields.summary, kind: FIELD_KINDS.long },
]

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

type LongBoxProps = FieldBoxProps

const LongBox = ({ id, value, onChange }: LongBoxProps) => (
  <textarea id={id} rows={4} value={value} onChange={(event) => onChange(event.target.value)} />
)

const FIELD_BOXES = {
  [FIELD_KINDS.text]: TextBox,
  [FIELD_KINDS.number]: NumberBox,
  [FIELD_KINDS.long]: LongBox,
} as const satisfies Record<FieldKind, ComponentType<FieldBoxProps>>

/** What the form holds: every field as text, so an empty box means "nothing". */
type Draft = Record<Field, string>

const toDraft = (metadata: ItemMetadata): Draft => ({
  title: metadata.title,
  year: metadata.year == null ? '' : String(metadata.year),
  contentRating: metadata.contentRating ?? '',
  tagline: metadata.tagline ?? '',
  summary: metadata.summary ?? '',
})

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

type MetadataEditorProps = {
  /** The item, its `versions` the files on the card the page is for. */
  details: ItemDetails
  /** A movie's files in the page's library, on every card. */
  everyCard?: readonly MediaItem[]
  itemKind: MatchItemType
  onDone: () => void
}

/**
 * Edit metadata: a movie's files, which Split apart gives a card each when
 * several share one, then the title, year, rating, tagline and summary a
 * page shows, each beside what TMDB says. A field written over keeps TMDB's
 * words underneath, and "Use TMDB's" puts them back; a refresh never
 * touches an edit. The wand puts the file name's edition in brackets after
 * the title. Cancel sits at the top, as Done does in Edit images, and Save
 * at the end of the form.
 */
export const MetadataEditor = ({
  details,
  everyCard = details.versions,
  itemKind,
  onDone,
}: MetadataEditorProps) => {
  const ids = { heading: useId(), form: useId() }
  const queryClient = useQueryClient()
  const state = useQuery(itemMetadataQuery(details.id))
  // What the viewer has typed; until then, what the page shows.
  const [edited, setDraft] = useState<Draft | null>(null)
  const draft = edited ?? (state.data ? toDraft(state.data.shown) : null)

  const save = useMutation({
    mutationFn: (change: ItemMetadataChange) => api.setItemMetadata({ id: details.id, change }),
    onSuccess: async (updated) => {
      await afterItemEdited({ queryClient, updated, part: EDITED_PARTS.metadata })
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
    // A field back at TMDB's words is cleared rather than written over with
    // the same. One emptied where TMDB has words goes as '' (0 for the year),
    // which shows nothing, as null would bring TMDB's back.
    const change = FIELDS.reduce<ItemMetadataChange>((sent, field) => {
      const value = valueOf({ key: field.key, text: draft[field.key] })
      const empty = field.key === FIELD_KEYS.year ? 0 : ''
      return { ...sent, [field.key]: value === original[field.key] ? null : (value ?? empty) }
    }, {})
    save.mutate(change)
  }

  return (
    <section className={styles.editor} aria-labelledby={ids.heading}>
      <header className={styles.header}>
        <h2 id={ids.heading} className={styles.heading}>
          {COMMON_COPY.editMetadata}
        </h2>
        <Button icon="close" onClick={onDone}>
          {COMMON_COPY.cancel}
        </Button>
      </header>
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
        <form id={ids.form} className={styles.form} onSubmit={submit}>
          {FIELDS.map((field) => {
            const id = `${ids.form}-${field.key}`
            const originalText = toDraft(original)[field.key]
            const differs = draft[field.key].trim() !== originalText.trim()
            const FieldBox = FIELD_BOXES[field.kind]
            return (
              <div key={field.key} className={styles.field}>
                <label htmlFor={id}>{field.label}</label>
                <div
                  className={
                    field.key === FIELD_KEYS.title && edition ? styles.withWand : styles.control
                  }
                >
                  <FieldBox
                    id={id}
                    value={draft[field.key]}
                    onChange={(value) => setDraft({ ...draft, [field.key]: value })}
                  />
                  {field.key === FIELD_KEYS.title && edition && (
                    <Button
                      icon="wand"
                      aria-label={METADATA_EDITOR_COPY.addEdition(edition)}
                      title={METADATA_EDITOR_COPY.titleItAs(
                        METADATA_EDITOR_COPY.editionTitle({ title: original.title, edition }),
                      )}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          title: METADATA_EDITOR_COPY.editionTitle({
                            title: original.title,
                            edition,
                          }),
                        })
                      }
                    />
                  )}
                </div>
                <p className={styles.original}>
                  <span>
                    {METADATA_EDITOR_COPY.tmdb(
                      originalText === '' ? METADATA_EDITOR_COPY.nothing : originalText,
                    )}
                  </span>
                  {differs && (
                    <button
                      type="button"
                      className={styles.reset}
                      onClick={() => setDraft({ ...draft, [field.key]: originalText })}
                    >
                      {METADATA_EDITOR_COPY.useTmdbs}
                    </button>
                  )}
                </p>
              </div>
            )
          })}
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
    </section>
  )
}
