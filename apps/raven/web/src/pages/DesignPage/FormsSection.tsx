import { type ReactNode, useId } from 'react'
import { Button } from '@/components/Button/Button'
import { DesignSection, Specimen } from '@/pages/DesignPage/DesignSection'
import styles from '@/pages/DesignPage/DesignPage.module.scss'

/** A label above its control, and a hint or error below when there is one. */
const Field = ({
  label,
  hint,
  children,
  id,
}: {
  label: string
  hint?: string
  children: ReactNode
  id: string
}) => (
  <div className={styles.field}>
    <label htmlFor={id}>{label}</label>
    {children}
    {!!hint && (
      <span id={`${id}-hint`} className={styles.hint}>
        {hint}
      </span>
    )}
  </div>
)

const TEXT_INPUTS: Array<{ type: string; label: string; placeholder?: string; value?: string }> = [
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
    <DesignSection
      id="forms"
      title="Forms"
      intro="One field look for everything you type into, a lichen ring that fills with bark for choices, and the browser's own sliders and gauges in bark."
    >
      <form className={styles.form} onSubmit={(event) => event.preventDefault()}>
        <Specimen name="Text fields">
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
            <Field id={`${id}-invalid`} label="Invalid" hint="Give the library a name.">
              <input
                id={`${id}-invalid`}
                type="text"
                aria-invalid="true"
                aria-describedby={`${id}-invalid-hint`}
              />
            </Field>
            <Field id={`${id}-disabled`} label="Disabled">
              <input id={`${id}-disabled`} type="text" defaultValue="Read only for now" disabled />
            </Field>
          </div>
        </Specimen>

        <Specimen name="Textarea">
          <Field id={`${id}-textarea`} label="Notes">
            <textarea
              id={`${id}-textarea`}
              defaultValue="The first season is in 4K; the rest is 1080p."
            />
          </Field>
        </Specimen>

        <Specimen name="Select">
          <div className={styles.fields}>
            <Field id={`${id}-select`} label="Sort">
              <select id={`${id}-select`} defaultValue="added">
                <option value="title">Title</option>
                <option value="added">Recently added</option>
                <option value="largest">Largest file</option>
              </select>
            </Field>
            <Field id={`${id}-multiple`} label="Several at once">
              <select id={`${id}-multiple`} multiple size={3} defaultValue={['hevc', 'av1']}>
                <option value="h264">H.264</option>
                <option value="hevc">HEVC</option>
                <option value="av1">AV1</option>
              </select>
            </Field>
            <Field id={`${id}-select-disabled`} label="Disabled">
              <select id={`${id}-select-disabled`} disabled>
                <option>Resolution</option>
              </select>
            </Field>
          </div>
        </Specimen>

        <Specimen name="Checkboxes">
          <div className={styles.choices}>
            <label className={styles.choice}>
              <input type="checkbox" defaultChecked /> Save where each video stopped
            </label>
            <label className={styles.choice}>
              <input type="checkbox" /> Pin to the side menu
            </label>
            <label className={styles.choice}>
              <input
                type="checkbox"
                ref={(element) => {
                  if (element) element.indeterminate = true
                }}
              />{' '}
              Some of them
            </label>
            <label className={styles.choice}>
              <input type="checkbox" disabled defaultChecked /> Disabled
            </label>
          </div>
        </Specimen>

        <Specimen name="Radios">
          <fieldset>
            <legend>Subtitles</legend>
            <label className={styles.choice}>
              <input type="radio" name={`${id}-subtitles`} defaultChecked /> Off
            </label>
            <label className={styles.choice}>
              <input type="radio" name={`${id}-subtitles`} /> English
            </label>
            <label className={styles.choice}>
              <input type="radio" name={`${id}-subtitles`} disabled /> Japanese (image based)
            </label>
          </fieldset>
        </Specimen>

        <Specimen name="Range, colour and file">
          <div className={styles.fields}>
            <Field id={`${id}-range`} label="Volume">
              <input id={`${id}-range`} type="range" min={0} max={100} defaultValue={70} />
            </Field>
            <Field id={`${id}-colour`} label="Colour">
              <input id={`${id}-colour`} type="color" defaultValue="#a8262f" />
            </Field>
            <Field id={`${id}-file`} label="File">
              <input id={`${id}-file`} type="file" />
            </Field>
          </div>
        </Specimen>

        <Specimen name="Progress and meter">
          <div className={styles.fields}>
            <Field id={`${id}-progress`} label="Scan progress">
              <progress id={`${id}-progress`} value={0.6} />
            </Field>
            <Field id={`${id}-meter`} label="Disk used">
              <meter id={`${id}-meter`} value={0.4} />
            </Field>
          </div>
        </Specimen>

        <Specimen
          name="Buttons"
          note="Use the Button component; plain input buttons match its quiet tone."
        >
          <div className={styles.row}>
            <Button tone="primary" icon="plus" type="submit">
              Add library
            </Button>
            <Button icon="rescan">Rescan</Button>
            <Button tone="danger" icon="trash">
              Delete library
            </Button>
            <Button disabled>Disabled</Button>
            <input type="submit" value="Submit" />
            <input type="reset" value="Reset" />
          </div>
        </Specimen>
      </form>
    </DesignSection>
  )
}
