import { designTokens } from '@/styles/designTokens'
import { ColourSection } from '@/pages/DesignPage/ColourSection'
import { ComponentsSection } from '@/pages/DesignPage/ComponentsSection'
import { ContentSection } from '@/pages/DesignPage/ContentSection'
import { FormsSection } from '@/pages/DesignPage/FormsSection'
import { TextSection } from '@/pages/DesignPage/TextSection'
import { TokensSection } from '@/pages/DesignPage/TokensSection'
import styles from '@/pages/DesignPage/DesignPage.module.scss'

const CONTENTS: Array<{ id: string; title: string }> = [
  { id: 'colour', title: 'Colour' },
  { id: 'tokens', title: 'Tokens' },
  { id: 'text', title: 'Text' },
  { id: 'forms', title: 'Forms' },
  { id: 'content', title: 'Content' },
  { id: 'components', title: 'Components' },
]

/**
 * raven's design on one page: the palette and every token, how each HTML
 * element looks, and every shared component. Reached at /design; not in
 * the side menu.
 */
export const DesignPage = () => (
  <article className={styles.page} aria-labelledby="design-title">
    <header className={styles.header}>
      <h1 id="design-title" className={styles.title}>
        Design
      </h1>
      <p className={styles.lede}>
        The palette, the tokens, every HTML element and every shared component, as the app draws
        them.
      </p>
      <nav aria-label="On this page">
        <ul className={styles.contents}>
          {CONTENTS.map((entry) => (
            <li key={entry.id}>
              <a href={`#${entry.id}`} className={styles.contentsLink}>
                {entry.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </header>
    <ColourSection tokens={designTokens} />
    <TokensSection tokens={designTokens} />
    <TextSection />
    <FormsSection />
    <ContentSection />
    <ComponentsSection />
  </article>
)
