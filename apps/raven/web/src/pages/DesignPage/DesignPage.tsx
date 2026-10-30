import { designTokens } from '@raven/ui/designTokens'
import { Link } from 'react-router-dom'
import { BackButton, HOME } from '@/components/BackButton/BackButton'
import { ColourSection } from '@/pages/DesignPage/ColourSection'
import { ComponentsSection } from '@/pages/DesignPage/ComponentsSection'
import { ContentSection } from '@/pages/DesignPage/ContentSection'
import { SECTIONS, sectionNumber } from '@/pages/DesignPage/contents'
import { DESIGN_COPY } from '@/pages/DesignPage/copy'
import { FormsSection } from '@/pages/DesignPage/FormsSection'
import { LogoSection } from '@/pages/DesignPage/LogoSection'
import { TextSection } from '@/pages/DesignPage/TextSection'
import { TokensSection } from '@/pages/DesignPage/TokensSection'
import styles from '@/pages/DesignPage/DesignPage.module.scss'

/**
 * raven's design on one page: the logo, the palette in the theme worn and
 * every theme beside it, every token at its true size, how each HTML
 * element looks, and every shared component. A numbered contents bar stays
 * at the top while it scrolls. Reached at /design; not in the side menu.
 */
export const DesignPage = () => (
  <article className={styles.page} aria-labelledby="design-title">
    <BackButton fallback={HOME} />
    <header className={styles.header}>
      <p className={styles.eyebrow}>{DESIGN_COPY.page.eyebrow}</p>
      <h1 id="design-title" className={styles.title}>
        {DESIGN_COPY.page.title}
      </h1>
      <p className={styles.lede}>{DESIGN_COPY.page.lede}</p>
    </header>
    <nav aria-label={DESIGN_COPY.page.contents} className={styles.contents}>
      <ol className={styles.contentsList}>
        {SECTIONS.map((section) => (
          <li key={section.id}>
            {/* A plain #anchor pushes an entry the router did not make, which costs Back its place in the app. */}
            <Link
              to={{ hash: section.id }}
              replace
              className={styles.contentsLink}
              onClick={() => document.getElementById(section.id)?.scrollIntoView()}
            >
              <span className={styles.contentsNumber} aria-hidden="true">
                {sectionNumber(section.id)}
              </span>
              {section.title}
            </Link>
          </li>
        ))}
      </ol>
    </nav>
    <div className={styles.sections}>
      <LogoSection />
      <ColourSection tokens={designTokens} />
      <TokensSection tokens={designTokens} />
      <TextSection />
      <FormsSection />
      <ContentSection />
      <ComponentsSection />
    </div>
  </article>
)
