import { Link } from 'react-router-dom'
import { DESIGN_COPY } from '@raven/wren'
import { WREN_ROUTES } from '@/routes'
import { ColourSection } from '@/screens/Design/ColourSection'
import { ComponentsSection } from '@/screens/Design/ComponentsSection'
import { LogoSection } from '@/screens/Design/LogoSection'
import { SECTIONS, type SectionId, sectionNumber, sectionTitle } from '@/screens/Design/sections'
import { TextSection } from '@/screens/Design/TextSection'
import { TokensSection } from '@/screens/Design/TokensSection'
import { useGoBack } from '@/shell/useGoBack'
import { Page } from '@/shell/Page/Page'
import { PageHeader } from '@/ui/PageHeader/PageHeader'
import styles from '@/screens/Design/Design.module.scss'

type ScrollToSectionProps = { id: SectionId }

/** Brings a section into view by its id, where the page holds it. */
const scrollToSection = ({ id }: ScrollToSectionProps) => {
  const section = document.getElementById(id)
  if (section === null) return
  section.scrollIntoView()
}

/**
 * `/design`: Wren's design on one page, as raven's `/design` is raven's: the logo, the palette
 * of each theme, every token at its true size, the type styles and the kit's components, with a
 * numbered contents bar that stays at the top while it scrolls. It reads `globals.scss` itself.
 * The web alone has it, so it is no page of the apps' `app/` and is not in the sidebar.
 */
export function Design() {
  const goBack = useGoBack({ fallback: WREN_ROUTES.settings })
  return (
    <Page className={styles.page}>
      <PageHeader
        back={{ to: DESIGN_COPY.page.back, onPress: goBack }}
        title={DESIGN_COPY.page.title}
      />
      <p className={styles.lede}>{DESIGN_COPY.page.lede}</p>
      <nav aria-label={DESIGN_COPY.page.contents} className={styles.contents}>
        <ol className={styles.contentsList}>
          {SECTIONS.map((id) => (
            <li key={id}>
              {/* A plain #anchor pushes an entry the router did not make, which costs Back its place. */}
              <Link
                className={styles.contentsLink}
                onClick={() => scrollToSection({ id })}
                replace
                to={{ hash: id }}
              >
                <span aria-hidden="true" className={styles.contentsNumber}>
                  {sectionNumber({ id })}
                </span>
                {sectionTitle({ id })}
              </Link>
            </li>
          ))}
        </ol>
      </nav>
      <div className={styles.sections}>
        <LogoSection />
        <ColourSection />
        <TokensSection />
        <TextSection />
        <ComponentsSection />
      </div>
    </Page>
  )
}
