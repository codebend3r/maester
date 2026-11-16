import { useId, useState } from 'react'
import { BUTTON_TONES, Button } from '@raven/ui'
import { DialogFrame, DIALOG_WIDTHS } from '@/components/DialogFrame/DialogFrame'
import { useModal } from '@/lib/useModal'
import { SECTION_IDS } from '@/pages/DesignPage/contents'
import { DESIGN_COPY } from '@/pages/DesignPage/copy'
import { DesignSection, Specimen } from '@/pages/DesignPage/DesignSection'
import styles from '@/pages/DesignPage/DesignPage.module.scss'

const COPY = DESIGN_COPY.content

type SampleDialogProps = { onClose: () => void }

/** The dialog specimen: the frame every modal dialog in raven opens in. */
const SampleDialog = ({ onClose }: SampleDialogProps) => {
  const { dialog, keepKeys, close } = useModal()
  const titleId = useId()
  return (
    <DialogFrame
      dialog={dialog}
      width={DIALOG_WIDTHS.question}
      labelledBy={titleId}
      onClose={onClose}
      onKeyDown={keepKeys}
    >
      <div className={styles.dialogBody}>
        <h2 id={titleId} className={styles.dialogTitle}>
          {COPY.dialogTitle}
        </h2>
        <p className={styles.dialogText}>{COPY.dialogText}</p>
        <div className={styles.dialogActions}>
          <Button tone={BUTTON_TONES.primary} onClick={close}>
            {COPY.close}
          </Button>
        </div>
      </div>
    </DialogFrame>
  )
}

export const ContentSection = () => {
  const [isOpen, setOpen] = useState(false)
  return (
    <DesignSection id={SECTION_IDS.content}>
      <Specimen name={COPY.table}>
        <table className={styles.table}>
          <caption>{COPY.caption}</caption>
          <thead>
            <tr>
              <th scope="col">{COPY.library}</th>
              <th scope="col" className={styles.number}>
                {COPY.videos}
              </th>
              <th scope="col" className={styles.number}>
                {COPY.size}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">{COPY.movies}</th>
              <td className={styles.number}>{COPY.moviesVideos}</td>
              <td className={styles.number}>{COPY.moviesSize}</td>
            </tr>
            <tr>
              <th scope="row">{COPY.shows}</th>
              <td className={styles.number}>{COPY.showsVideos}</td>
              <td className={styles.number}>{COPY.showsSize}</td>
            </tr>
          </tbody>
        </table>
      </Specimen>

      <Specimen name={COPY.details}>
        <div className={styles.measure}>
          <details>
            <summary>{COPY.whyConvert}</summary>
            <p>{COPY.whyConvertAnswer}</p>
          </details>
          <details open>
            <summary>{COPY.finished}</summary>
            <p>{COPY.finishedAnswer}</p>
          </details>
        </div>
      </Specimen>

      <Specimen name={COPY.figure}>
        <figure className={styles.figure}>
          <div className={styles.figureFrame}>{COPY.figureFrame}</div>
          <figcaption>{COPY.figcaption}</figcaption>
        </figure>
      </Specimen>

      <Specimen name={COPY.dialog} note={COPY.dialogNote}>
        <div className={styles.row}>
          <Button onClick={() => setOpen(true)}>{COPY.openDialog}</Button>
        </div>
        {isOpen && <SampleDialog onClose={() => setOpen(false)} />}
      </Specimen>
    </DesignSection>
  )
}
