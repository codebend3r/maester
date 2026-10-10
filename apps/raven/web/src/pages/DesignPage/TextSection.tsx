import { DesignSection, Specimen } from '@/pages/DesignPage/DesignSection'
import styles from '@/pages/DesignPage/DesignPage.module.scss'

export const TextSection = () => (
  <DesignSection
    id="text"
    title="Text"
    intro="The display serif sets the top three heading levels; the body face sets the rest and everything you read."
  >
    <Specimen name="Headings" note="h1 is a page's title; h6 labels a small group.">
      <div className={styles.stack}>
        <h1>Heading one</h1>
        <h2>Heading two</h2>
        <h3>Heading three</h3>
        <h4>Heading four</h4>
        <h5>Heading five</h5>
        <h6>Heading six</h6>
      </div>
    </Specimen>

    <Specimen name="Paragraph and inline">
      <div className="prose">
        <p>
          A library is a set of folders. Every video inside is indexed, given a thumbnail, and{' '}
          <a href="#text">ready to play</a>. Some words are <strong>strong</strong>, some are{' '}
          <em>emphasised</em>, and some are <small>small print</small>. Search results{' '}
          <mark>highlight</mark> what matched.
        </p>
        <p>
          The player reads <code>ffprobe</code> output; press <kbd>k</kbd> to pause and <kbd>?</kbd>{' '}
          for every shortcut. <abbr title="High dynamic range">HDR</abbr> is tone mapped. The price
          was <del>12</del> <ins>9</ins>. Water is H<sub>2</sub>O and a square is x<sup>2</sup>.
        </p>
      </div>
    </Specimen>

    <Specimen name="Quote">
      <blockquote>
        <p>
          A reader lives a thousand lives before he dies. The man who never reads lives only one.
        </p>
      </blockquote>
    </Specimen>

    <Specimen name="Preformatted">
      <pre>
        <code>{`docker compose up -d --build\nopen http://localhost:8484`}</code>
      </pre>
    </Specimen>

    <Specimen
      name="Lists"
      note="Bare by default, since most lists are layout; .prose brings back markers."
    >
      <div className={`prose ${styles.columns}`}>
        <ul>
          <li>Movies</li>
          <li>Shows</li>
          <li>Home videos</li>
        </ul>
        <ol>
          <li>Add a library</li>
          <li>Wait for the scan</li>
          <li>Press play</li>
        </ol>
        <dl>
          <dt>Direct play</dt>
          <dd>The browser plays the file as it is.</dd>
          <dt>Converted</dt>
          <dd>The server remuxes or transcodes on the fly.</dd>
        </dl>
      </div>
    </Specimen>

    <Specimen name="Rule">
      <hr />
    </Specimen>
  </DesignSection>
)
