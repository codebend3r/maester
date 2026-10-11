import { type DesignToken, contrastRatio } from '@/lib/tokens'
import { DesignSection } from '@/pages/DesignPage/DesignSection'
import styles from '@/pages/DesignPage/DesignPage.module.scss'

/** The grounds text sits on, which every swatch is measured against. */
const GROUNDS = ['--color-night', '--color-canopy']

const ratio = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })

export const ColourSection = ({ tokens }: { tokens: readonly DesignToken[] }) => {
  const colours = tokens.filter((token) => token.group === 'colour')
  const grounds = colours.filter((token) => GROUNDS.includes(token.name))
  return (
    <DesignSection
      id="colour"
      title="Colour"
      intro="A godswood at night for the ground, bone-white bark for text, and red leaves kept for where you stopped watching and the one action a screen is for. Contrast is the WCAG ratio against each ground."
    >
      <ul className={styles.swatches}>
        {colours.map((token) => (
          <li key={token.name} className={styles.swatch}>
            <span className={styles.chip} style={{ background: `var(${token.name})` }} />
            <h3 className={styles.tokenName}>{token.name}</h3>
            <code className={styles.tokenValue}>{token.value}</code>
            {!!token.note && <p className={styles.note}>{token.note}</p>}
            <dl className={styles.contrast}>
              {grounds
                .filter((ground) => ground.name !== token.name)
                .map((ground) => {
                  const measured = contrastRatio({
                    foreground: token.value,
                    background: ground.value,
                  })
                  return (
                    <div key={ground.name} className={styles.contrastRow}>
                      <dt>On {ground.name.replace('--color-', '')}</dt>
                      <dd>{measured == null ? 'Varies' : `${ratio.format(measured)}:1`}</dd>
                    </div>
                  )
                })}
            </dl>
          </li>
        ))}
      </ul>
    </DesignSection>
  )
}
