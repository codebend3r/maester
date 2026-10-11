import { useRef } from 'react'
import { Button } from '@/components/Button/Button'
import { DesignSection, Specimen } from '@/pages/DesignPage/DesignSection'
import styles from '@/pages/DesignPage/DesignPage.module.scss'

export const ContentSection = () => {
  const dialog = useRef<HTMLDialogElement>(null)
  return (
    <DesignSection id="content" title="Content">
      <Specimen name="Table">
        <table>
          <caption>Libraries on this server</caption>
          <thead>
            <tr>
              <th scope="col">Library</th>
              <th scope="col">Videos</th>
              <th scope="col">Size</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Movies</th>
              <td>1,242</td>
              <td>8.1 TB</td>
            </tr>
            <tr>
              <th scope="row">Shows</th>
              <td>2,772</td>
              <td>5.4 TB</td>
            </tr>
          </tbody>
        </table>
      </Specimen>

      <Specimen name="Details">
        <details>
          <summary>Why does this file convert?</summary>
          <p>Firefox cannot decode HEVC, so the server transcodes it to H.264 as it plays.</p>
        </details>
        <details open>
          <summary>What counts as finished?</summary>
          <p>The last 5% of a video. The next play starts from the top.</p>
        </details>
      </Specimen>

      <Specimen name="Figure">
        <figure>
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
        <dialog ref={dialog} aria-labelledby="design-dialog-title">
          <div className={styles.dialogBody}>
            <h2 id="design-dialog-title">A dialog</h2>
            <p>It sits on the canopy colour over a scrim.</p>
            <div className={styles.row}>
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
