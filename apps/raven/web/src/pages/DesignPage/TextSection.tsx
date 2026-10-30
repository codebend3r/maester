import { SECTION_IDS } from '@/pages/DesignPage/contents'
import { DESIGN_COPY } from '@/pages/DesignPage/copy'
import { DesignSection, Specimen } from '@/pages/DesignPage/DesignSection'
import styles from '@/pages/DesignPage/DesignPage.module.scss'

const COPY = DESIGN_COPY.text

export const TextSection = () => (
  <DesignSection id={SECTION_IDS.text} intro={COPY.intro}>
    <Specimen name={COPY.headings} note={COPY.headingsNote}>
      <div className={styles.headings}>
        <div className={styles.headingRow}>
          <code className={styles.tag}>{COPY.tags.h1}</code>
          <h1>{COPY.headingOne}</h1>
        </div>
        <div className={styles.headingRow}>
          <code className={styles.tag}>{COPY.tags.h2}</code>
          <h2>{COPY.headingTwo}</h2>
        </div>
        <div className={styles.headingRow}>
          <code className={styles.tag}>{COPY.tags.h3}</code>
          <h3>{COPY.headingThree}</h3>
        </div>
        <div className={styles.headingRow}>
          <code className={styles.tag}>{COPY.tags.h4}</code>
          <h4>{COPY.headingFour}</h4>
        </div>
        <div className={styles.headingRow}>
          <code className={styles.tag}>{COPY.tags.h5}</code>
          <h5>{COPY.headingFive}</h5>
        </div>
        <div className={styles.headingRow}>
          <code className={styles.tag}>{COPY.tags.h6}</code>
          <h6>{COPY.headingSix}</h6>
        </div>
      </div>
    </Specimen>

    <Specimen name={COPY.paragraph}>
      <div className="prose">
        <p>
          {COPY.library.lead}
          <a href={`#${SECTION_IDS.text}`}>{COPY.library.link}</a>
          {COPY.library.beforeStrong}
          <strong>{COPY.library.strong}</strong>
          {COPY.library.beforeEm}
          <em>{COPY.library.em}</em>
          {COPY.library.beforeSmall}
          <small>{COPY.library.small}</small>
          {COPY.library.beforeMark}
          <mark>{COPY.library.mark}</mark>
          {COPY.library.end}
        </p>
        <p>
          {COPY.player.lead}
          <code>{COPY.player.code}</code>
          {COPY.player.beforeK}
          <kbd>{COPY.player.k}</kbd>
          {COPY.player.beforeQuestion}
          <kbd>{COPY.player.question}</kbd>
          {COPY.player.beforeAbbr}
          <abbr title={COPY.player.abbrTitle}>{COPY.player.abbr}</abbr>
          {COPY.player.beforeDel}
          <del>{COPY.player.del}</del> <ins>{COPY.player.ins}</ins>
          {COPY.player.beforeSub}
          <sub>{COPY.player.sub}</sub>
          {COPY.player.beforeSup}
          <sup>{COPY.player.sup}</sup>
          {COPY.player.end}
        </p>
      </div>
    </Specimen>

    <Specimen name={COPY.quote}>
      <blockquote>
        <p>{COPY.quoteText}</p>
      </blockquote>
    </Specimen>

    <Specimen name={COPY.preformatted}>
      <pre>
        <code>
          <span className={styles.prompt}>{COPY.prompt}</span>
          {COPY.compose}
          <span className={styles.prompt}>{COPY.prompt}</span>
          {COPY.open}
        </code>
      </pre>
    </Specimen>

    <Specimen name={COPY.lists} note={COPY.listsNote}>
      <div className={`prose ${styles.columns}`}>
        <ul>
          {COPY.unordered.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <ol>
          {COPY.ordered.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
        <dl>
          <dt>{COPY.directPlay}</dt>
          <dd>{COPY.directPlayNote}</dd>
          <dt>{COPY.converted}</dt>
          <dd>{COPY.convertedNote}</dd>
        </dl>
      </div>
    </Specimen>

    <Specimen name={COPY.rule}>
      <hr />
    </Specimen>
  </DesignSection>
)
