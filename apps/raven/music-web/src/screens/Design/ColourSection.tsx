import { type DesignToken, contrastRatio } from '@raven/core'
import { DESIGN_COPY, SETTINGS_COPY } from '@raven/wren'
import { DesignSection } from '@/screens/Design/DesignSection'
import { FIXED_COLOURS, PALETTES, type Palette } from '@/screens/Design/designTokens'
import { SECTION_IDS } from '@/screens/Design/sections'
import { COLOR_TOKEN_NAMES } from '@/theme/tokens'
import styles from '@/screens/Design/Design.module.scss'

const COPY = DESIGN_COPY.colour

/** The colours text is drawn in, which a swatch shows the contrast of. */
const TEXT_COLOURS: ReadonlySet<string> = new Set([
  COLOR_TOKEN_NAMES.text,
  COLOR_TOKEN_NAMES.text2,
  COLOR_TOKEN_NAMES.text3,
  COLOR_TOKEN_NAMES.accentText,
])

type ContrastOfProps = {
  token: DesignToken
  /** The palette's ground, if it declares one. */
  ground: DesignToken | undefined
}

/** How a text colour reads on its palette's ground, or null for a colour that is no text or has alpha. */
const contrastOf = ({ token, ground }: ContrastOfProps): string | null => {
  if (!TEXT_COLOURS.has(token.name) || ground === undefined) return null
  const ratio = contrastRatio({ foreground: token.value, background: ground.value })
  return ratio === null ? null : COPY.contrast(ratio.toFixed(1))
}

type SwatchProps = {
  token: DesignToken
  contrast: string | null
}

function Swatch({ token, contrast }: SwatchProps) {
  return (
    <li className={styles.swatch}>
      <span className={styles.chip} style={{ background: `var(${token.name})` }} />
      <code className={styles.tokenName}>{token.name}</code>
      <span className={styles.value}>{token.value}</span>
      {contrast !== null && <span className={styles.note}>{contrast}</span>}
      {token.note !== null && <span className={styles.note}>{token.note}</span>}
    </li>
  )
}

type PalettePanelProps = { palette: Palette }

/** One theme on its own ground, which its `data-theme` gives it, with every colour it declares. */
function PalettePanel({ palette }: PalettePanelProps) {
  const label = SETTINGS_COPY.themeNames[palette.id]
  const ground = palette.tokens.find(({ name }) => name === COLOR_TOKEN_NAMES.ground)
  return (
    <section aria-label={label} className={styles.palette} data-theme={palette.id}>
      <h3 className={styles.paletteName}>{label}</h3>
      <ul aria-label={COPY.swatches} className={styles.swatches}>
        {palette.tokens.map((token) => (
          <Swatch contrast={contrastOf({ token, ground })} key={token.name} token={token} />
        ))}
      </ul>
    </section>
  )
}

/** The palette of every theme, and the colours no theme changes. */
export function ColourSection() {
  return (
    <DesignSection id={SECTION_IDS.colour} intro={COPY.intro}>
      <div className={styles.palettes}>
        {PALETTES.map((palette) => (
          <PalettePanel key={palette.id} palette={palette} />
        ))}
      </div>
      <h3 className={styles.groupName}>{COPY.fixed}</h3>
      <p className={styles.note}>{COPY.fixedNote}</p>
      <ul aria-label={COPY.fixed} className={styles.swatches}>
        {FIXED_COLOURS.map((token) => (
          <Swatch contrast={null} key={token.name} token={token} />
        ))}
      </ul>
    </DesignSection>
  )
}
