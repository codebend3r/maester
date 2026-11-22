import { DESIGN_COPY } from '@raven/wren'
import { DesignSection, TokenLine } from '@/screens/Design/DesignSection'
import { TYPE_STYLES } from '@/screens/Design/designTokens'
import { SECTION_IDS } from '@/screens/Design/sections'
import styles from '@/screens/Design/Design.module.scss'

const COPY = DESIGN_COPY.text

/** Each type style set as the `font` value it is. */
export function TextSection() {
  return (
    <DesignSection id={SECTION_IDS.text} intro={COPY.intro}>
      <ul aria-label={COPY.list} className={styles.tokens}>
        {TYPE_STYLES.map((token) => (
          <TokenLine key={token.name} token={token}>
            <span className={styles.typeSample} style={{ font: `var(${token.name})` }}>
              {COPY.sampleText}
            </span>
          </TokenLine>
        ))}
      </ul>
    </DesignSection>
  )
}
