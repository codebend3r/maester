import { designTokens } from '@raven/ui/designTokens'
import { BackButton } from '@/components/BackButton/BackButton'
import { ColourSection } from '@/pages/DesignPage/ColourSection'
import { ComponentsSection } from '@/pages/DesignPage/ComponentsSection'
import { ContentSection } from '@/pages/DesignPage/ContentSection'
import { SECTIONS, sectionNumber } from '@/pages/DesignPage/contents'
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
    <BackButton fallback={{ to: '/', label: 'Home' }} />
    <header className={styles.header}>
      <p className={styles.eyebrow}>Design system</p>
      <h1 id="design-title" className={styles.title}>
        Design
      </h1>
      <p className={styles.lede}>
        The logo, the palette, the tokens, every HTML element and every shared component, as the app
        draws them.
      </p>
    </header>
    <nav aria-label="On this page" className={styles.contents}>
      <ol className={styles.contentsList}>
        {SECTIONS.map((section) => (
          <li key={section.id}>
            <a href={`#${section.id}`} className={styles.contentsLink}>
              <span className={styles.contentsNumber} aria-hidden="true">
                {sectionNumber(section.id)}
              </span>
              {section.title}
            </a>
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
