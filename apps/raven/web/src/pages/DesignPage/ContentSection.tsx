import { useRef } from 'react'
import { Button } from '@raven/ui'
import { DesignSection, Specimen } from '@/pages/DesignPage/DesignSection'
import styles from '@/pages/DesignPage/DesignPage.module.scss'

export const ContentSection = () => {
  const dialog = useRef<HTMLDialogElement>(null)
  return (
    <DesignSection id="content">
      <Specimen name="Table">
        <table className={styles.table}>
          <caption>Libraries on this server</caption>
          <thead>
            <tr>
              <th scope="col">Library</th>
              <th scope="col" className={styles.number}>
                Videos
              </th>
              <th scope="col" className={styles.number}>
                Size
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Movies</th>
              <td className={styles.number}>1,242</td>
              <td className={styles.number}>8.1 TB</td>
            </tr>
            <tr>
              <th scope="row">Shows</th>
              <td className={styles.number}>2,772</td>
              <td className={styles.number}>5.4 TB</td>
            </tr>
          </tbody>
        </table>
      </Specimen>

      <Specimen name="Details">
        <div className={styles.measure}>
          <details>
            <summary>Why does this file convert?</summary>
            <p>Firefox cannot decode HEVC, so the server transcodes it to H.264 as it plays.</p>
          </details>
          <details open>
            <summary>What counts as finished?</summary>
            <p>The last 5% of a video. The next play starts from the top.</p>
          </details>
        </div>
      </Specimen>

      <Specimen name="Figure">
        <figure className={styles.figure}>
          <div className={styles.figureFrame}>raven</div>
          <figcaption>
            A thumbnail is one frame, 480 pixels wide, from 10% into the file.
          </figcaption>
        </figure>
      </Specimen>

      <Specimen name="Dialog" note="A native modal: focus stays inside and Escape closes it.">
        <div className={styles.row}>
          <Button onClick={() => dialog.current?.showModal()}>Open a dialog</Button>
        </div>
        <dialog ref={dialog} className={styles.dialog} aria-labelledby="design-dialog-title">
          <div className={styles.dialogBody}>
            <h2 id="design-dialog-title" className={styles.dialogTitle}>
              A dialog
            </h2>
            <p className={styles.dialogText}>It sits on the canopy colour over a scrim.</p>
            <div className={styles.dialogActions}>
              <Button tone="primary" onClick={() => dialog.current?.close()}>
                Close
              </Button>
            </div>
          </div>
        </dialog>
      </Specimen>
    </DesignSection>
  )
}
