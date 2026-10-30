import { type ReactNode, useId } from 'react'
import { Button, Icon } from '@raven/ui'
import { SECTION_IDS } from '@/pages/DesignPage/contents'
import { DESIGN_COPY } from '@/pages/DesignPage/copy'
import { DesignSection, Specimen } from '@/pages/DesignPage/DesignSection'
import styles from '@/pages/DesignPage/DesignPage.module.scss'

type FieldProps = {
  label: string
  error?: string
  aside?: string
  isDisabled?: boolean
  children: ReactNode
  id: string
}

/**
 * A label above its control, and under it the reason it was refused, with
 * the alert beside it. `aside` sits at the label's right: a gauge's reading.
 */
const Field = ({ label, error, aside, isDisabled = false, children, id }: FieldProps) => (
  <div className={styles.field}>
    <span className={styles.labelRow}>
      <label htmlFor={id} className={isDisabled ? styles.disabledLabel : undefined}>
        {label}
      </label>
      {!!aside && <span className={styles.reading}>{aside}</span>}
    </span>
    {children}
    {!!error && (
      <span id={`${id}-error`} className={styles.error}>
        <Icon name="alert" size={16} />
        {error}
      </span>
    )}
  </div>
)

const COPY = DESIGN_COPY.forms

type TextInput = { type: string; label: string; placeholder?: string; value?: string }

const TEXT_INPUTS: readonly TextInput[] = [
  { type: 'text', label: 'Text', placeholder: 'Movies' },
  { type: 'search', label: 'Search', placeholder: 'Search Movies' },
  { type: 'email', label: 'Email', placeholder: 'you@example.com' },
  { type: 'password', label: 'Password', value: 'hunter2hunter2' },
  { type: 'number', label: 'Number', value: '24' },
  { type: 'url', label: 'URL', placeholder: 'http://nas:8484' },
  { type: 'date', label: 'Date', value: '2026-10-09' },
  { type: 'time', label: 'Time', value: '20:30' },
]

export const FormsSection = () => {
  const id = useId()
  return (
    <DesignSection id={SECTION_IDS.forms} intro={COPY.intro}>
      <form className={styles.form} onSubmit={(event) => event.preventDefault()}>
        <Specimen name={COPY.textFields}>
          <div className={styles.fields}>
            {TEXT_INPUTS.map((input) => (
              <Field key={input.type} id={`${id}-${input.type}`} label={input.label}>
                <input
                  id={`${id}-${input.type}`}
                  type={input.type}
                  placeholder={input.placeholder}
                  defaultValue={input.value}
                  autoComplete="off"
                />
              </Field>
            ))}
            <Field id={`${id}-invalid`} label={COPY.invalid} error={COPY.invalidError}>
              <input
                id={`${id}-invalid`}
                type="text"
                aria-invalid="true"
                aria-describedby={`${id}-invalid-error`}
              />
            </Field>
            <Field id={`${id}-disabled`} label={COPY.disabled} isDisabled>
              <input id={`${id}-disabled`} type="text" defaultValue={COPY.readOnly} disabled />
            </Field>
          </div>
        </Specimen>

        <Specimen name={COPY.textarea}>
          <div className={styles.measure}>
            <Field id={`${id}-textarea`} label={COPY.notes}>
              <textarea id={`${id}-textarea`} defaultValue={COPY.notesValue} />
            </Field>
          </div>
        </Specimen>

        <Specimen name={COPY.select}>
          <div className={styles.fields}>
            <Field id={`${id}-select`} label={COPY.sort}>
              <select id={`${id}-select`} defaultValue="added">
                <option value="title">{COPY.sortTitle}</option>
                <option value="added">{COPY.sortAdded}</option>
                <option value="largest">{COPY.sortSize}</option>
              </select>
            </Field>
            <Field id={`${id}-multiple`} label={COPY.several}>
              <select id={`${id}-multiple`} multiple size={3} defaultValue={['hevc', 'av1']}>
                <option value="h264">{COPY.h264}</option>
                <option value="hevc">{COPY.hevc}</option>
                <option value="av1">{COPY.av1}</option>
              </select>
            </Field>
            <Field id={`${id}-select-disabled`} label={COPY.disabled} isDisabled>
              <select id={`${id}-select-disabled`} disabled>
                <option>{COPY.resolution}</option>
              </select>
            </Field>
          </div>
        </Specimen>

        <Specimen name={COPY.choices}>
          <div className={styles.choiceGroups}>
            <div className={styles.choices}>
              <label className={styles.choice}>
                <input type="checkbox" defaultChecked /> {COPY.saveWhere}
              </label>
              <label className={styles.choice}>
                <input type="checkbox" /> {COPY.pin}
              </label>
              <label className={styles.choice}>
                <input
                  type="checkbox"
                  ref={(element) => {
                    if (element) element.indeterminate = true
                  }}
                />{' '}
                {COPY.someOfThem}
              </label>
              <label className={styles.choice}>
                <input type="checkbox" disabled defaultChecked /> {COPY.disabled}
              </label>
            </div>
            <fieldset className={styles.radios}>
              <legend className={styles.legend}>{COPY.subtitles}</legend>
              <label className={styles.choice}>
                <input type="radio" name={`${id}-subtitles`} defaultChecked /> {COPY.off}
              </label>
              <label className={styles.choice}>
                <input type="radio" name={`${id}-subtitles`} /> {COPY.english}
              </label>
              <label className={styles.choice}>
                <input type="radio" name={`${id}-subtitles`} disabled /> {COPY.japanese}
              </label>
            </fieldset>
          </div>
        </Specimen>

        <Specimen name={COPY.rangeColourFile}>
          <div className={styles.fields}>
            <Field id={`${id}-range`} label={COPY.volume}>
              <input id={`${id}-range`} type="range" min={0} max={100} defaultValue={70} />
            </Field>
            <Field id={`${id}-colour`} label={COPY.colour}>
              <input id={`${id}-colour`} type="color" defaultValue="#a8262f" />
            </Field>
            <Field id={`${id}-file`} label={COPY.file}>
              <input id={`${id}-file`} type="file" />
            </Field>
          </div>
        </Specimen>

        <Specimen name={COPY.gauges}>
          <div className={styles.fields}>
            <Field id={`${id}-progress`} label={COPY.scanProgress} aside={COPY.scanReading}>
              <progress id={`${id}-progress`} value={0.6} className={styles.gauge} />
            </Field>
            <Field id={`${id}-meter`} label={COPY.diskUsed} aside={COPY.diskReading}>
              <meter id={`${id}-meter`} value={0.4} className={styles.gauge} />
            </Field>
          </div>
        </Specimen>

        <Specimen name={COPY.buttons} note={COPY.buttonsNote}>
          <div className={styles.row}>
            <Button tone="primary" icon="plus" type="submit">
              {COPY.addLibrary}
            </Button>
            <Button icon="rescan">{COPY.fullScan}</Button>
            <Button tone="danger" icon="trash">
              {COPY.deleteLibrary}
            </Button>
            <Button disabled>{COPY.disabled}</Button>
            <input type="submit" value={COPY.submit} />
            <input type="reset" value={COPY.reset} />
          </div>
        </Specimen>
      </form>
    </DesignSection>
  )
}
