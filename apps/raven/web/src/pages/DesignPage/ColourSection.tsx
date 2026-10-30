import {
  DEFAULT_THEME,
  type DesignToken,
  THEMES,
  TOKEN_GROUPS,
  type ThemeId,
  contrastRatio,
} from '@raven/core'
import { Icon } from '@raven/ui'
import { useTheme } from '@/stores/theme'
import { SECTION_IDS } from '@/pages/DesignPage/contents'
import { DESIGN_COPY } from '@/pages/DesignPage/copy'
import { DesignSection } from '@/pages/DesignPage/DesignSection'
import styles from '@/pages/DesignPage/ColourSection.module.scss'

/** The grounds text sits on, which every swatch is measured against. */
const GROUNDS = [
  { name: '--color-night', on: 'night' },
  { name: '--color-canopy', on: 'canopy' },
] as const

/** The four colours most of a screen is made of, shown large. */
const BAND = [
  { name: '--color-night', word: 'Night' },
  { name: '--color-canopy', word: 'Canopy' },
  { name: '--color-moss', word: 'Moss' },
  { name: '--color-bark', word: 'Bark' },
] as const

/** What a theme's tile shows of it besides its ground and text. */
const THEME_CHIPS = [
  '--color-canopy',
  '--color-moss',
  '--color-lichen',
  '--color-leaf',
  '--color-leaf-bright',
] as const

/** Body text needs 4.5:1 (WCAG AA); a ratio under it is marked as falling short. */
const BODY_TEXT_RATIO = 4.5

const COPY = DESIGN_COPY.colour

const ratio = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })

const SHORT_HEX = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i
const HEX = /^#[0-9a-f]{6}$/i

/** A colour as the built stylesheet may shorten it, `#fff`, written out as `#ffffff`. */
const longHex = (value: string): string =>
  value.replace(SHORT_HEX, (_, red: string, green: string, blue: string) =>
    `#${red}${red}${green}${green}${blue}${blue}`.toLowerCase(),
  )

/**
 * Each colour's value in the theme worn now, read off the page so it follows
 * the theme picker. Only the solid colours a theme sets are read: a colour
 * mixed from others, or one with alpha, keeps the way globals.scss writes
 * it, which says more than what the build turns it into. Where the page has
 * no value, as in a test, it is the declared one too.
 */
const useWornColours = () => {
  const theme = useTheme((state) => state.theme)
  const worn = getComputedStyle(document.documentElement)
  const valueOf = (token: DesignToken): string => {
    const value = longHex(worn.getPropertyValue(token.name).trim())
    return HEX.test(value) && !token.value.includes('var(') ? value : token.value
  }
  return { theme, valueOf }
}

type InkOnProps = { value: string; bark: string; night: string }

/** Bark or night, whichever reads better on `value`. */
const inkOn = ({ value, bark, night }: InkOnProps): string => {
  const onBark = contrastRatio({ foreground: bark, background: value }) ?? 0
  const onNight = contrastRatio({ foreground: night, background: value }) ?? 0
  return onBark >= onNight ? 'var(--color-bark)' : 'var(--color-night)'
}

type ContrastOfProps = { value: string; against: string }

/** How a colour reads on a ground: its ratio, and whether that is enough for body text. */
const contrastOf = ({ value, against }: ContrastOfProps) => {
  const measured = contrastRatio({ foreground: value, background: against })
  if (measured == null) return { text: COPY.varies, className: styles.varies }
  return {
    text: COPY.ratio(ratio.format(measured)),
    className: measured >= BODY_TEXT_RATIO ? styles.passes : styles.falls,
  }
}

type ThemeStripProps = { worn: ThemeId }

/** Every theme in miniature, each tile wearing its own: the ground, the text, play and the rest. */
const ThemeStrip = ({ worn }: ThemeStripProps) => (
  <div className={styles.themes}>
    <div className={styles.themesHeader}>
      <h3 className={styles.themesTitle}>{COPY.themes}</h3>
      <p className={styles.note}>{COPY.themesNote}</p>
    </div>
    <ul className={styles.themeList} aria-label={COPY.themes}>
      {THEMES.map((option) => {
        const isWorn = option.id === worn
        return (
          <li
            key={option.id}
            data-theme={option.id}
            className={styles.theme}
            aria-current={isWorn || undefined}
          >
            <span className={styles.themeChips} aria-hidden="true">
              {THEME_CHIPS.map((name) => (
                <span
                  key={name}
                  className={styles.themeChip}
                  style={{ background: `var(${name})` }}
                />
              ))}
            </span>
            <h4 className={styles.themeName}>{option.name}</h4>
            <p className={styles.themeNote}>{option.note}</p>
            <span className={styles.themeSample} aria-hidden="true">
              <span className={styles.themePlay}>
                <Icon name="play" size={14} />
                {COPY.play}
              </span>
              <span className={styles.themeTrack}>
                <span className={styles.themeProgress} />
              </span>
            </span>
            {isWorn && <span className={styles.worn}>{COPY.wornNow}</span>}
          </li>
        )
      })}
    </ul>
  </div>
)

type ColourSectionProps = { tokens: readonly DesignToken[] }

export const ColourSection = ({ tokens }: ColourSectionProps) => {
  const { theme, valueOf } = useWornColours()
  const colours = tokens.filter((token) => token.group === TOKEN_GROUPS.colour)
  const tokenNamed = (name: string) => colours.find((token) => token.name === name)
  const valueNamed = (name: string) => {
    const token = tokenNamed(name)
    return token ? valueOf(token) : ''
  }
  const grounds = GROUNDS.flatMap((ground) => {
    const token = tokenNamed(ground.name)
    return token ? [{ ...ground, value: valueOf(token) }] : []
  })
  const band = BAND.flatMap((entry) => {
    const token = tokenNamed(entry.name)
    return token ? [{ ...entry, value: valueOf(token) }] : []
  })
  const isDefault = theme === DEFAULT_THEME
  return (
    <DesignSection id={SECTION_IDS.colour} intro={COPY.intro}>
      <div className={styles.body}>
        {band.length > 0 && (
          <ul className={styles.band} aria-label={COPY.grounds}>
            {band.map((entry) => (
              <li
                key={entry.name}
                className={styles.ground}
                style={{
                  background: `var(${entry.name})`,
                  color: inkOn({
                    value: entry.value,
                    bark: valueNamed('--color-bark'),
                    night: valueNamed('--color-night'),
                  }),
                }}
              >
                <span className={styles.groundWord}>{entry.word}</span>
                <span className={styles.groundLabel}>
                  <span className={styles.groundName}>{entry.name}</span>
                  <code className={styles.groundValue}>{entry.value}</code>
                </span>
              </li>
            ))}
          </ul>
        )}
        <ul className={styles.swatches} aria-label={COPY.everyColour}>
          {colours.map((token) => {
            const value = valueOf(token)
            return (
              <li key={token.name} className={styles.swatch}>
                <div className={styles.swatchTop}>
                  <span className={styles.chip} style={{ background: `var(${token.name})` }} />
                  <div className={styles.swatchText}>
                    <h3 className={styles.tokenName}>{token.name}</h3>
                    <code className={styles.tokenValue}>{value}</code>
                  </div>
                  {isDefault && !!token.note && <p className={styles.swatchNote}>{token.note}</p>}
                </div>
                <dl className={styles.ratios}>
                  {grounds
                    .filter((ground) => ground.name !== token.name)
                    .map((ground) => {
                      const contrast = contrastOf({ value, against: ground.value })
                      return (
                        <div key={ground.name} className={`${styles.ratio} ${contrast.className}`}>
                          <dt>{COPY.on(ground.on)}</dt>
                          <dd>{contrast.text}</dd>
                        </div>
                      )
                    })}
                </dl>
              </li>
            )
          })}
        </ul>
        <ThemeStrip worn={theme} />
      </div>
    </DesignSection>
  )
}
