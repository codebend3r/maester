import type { DesignToken } from '@raven/ui'
import { DesignSection, Specimen } from '@/pages/DesignPage/DesignSection'
import { type Sample, groupTokens } from '@/pages/DesignPage/tokenGroups'
import styles from '@/pages/DesignPage/TokensSection.module.scss'

const SAMPLE_TEXT = 'The raven reads every folder'

/** A token drawn at its true size, read through var() so it is the live value. */
const TokenSample = ({ name, sample }: { name: string; sample: Sample }) => {
  const value = `var(${name})`
  switch (sample) {
    case 'bar':
      return <span className={styles.bar} style={{ width: value }} />
    case 'width':
      return <span className={styles.bar} style={{ width: `min(${value}, 100%)` }} />
    case 'radius':
      return <span className={styles.radius} style={{ borderRadius: value }} />
    case 'family':
      return (
        <span className={styles.family} style={{ fontFamily: value }}>
          {SAMPLE_TEXT}
        </span>
      )
    case 'size':
      return (
        <span className={styles.size} style={{ fontSize: value }}>
          {SAMPLE_TEXT}
        </span>
      )
    case 'line':
      return (
        <span className={styles.line} style={{ lineHeight: value }}>
          {`${SAMPLE_TEXT}, then waits for the next one, and the next.`}
        </span>
      )
    case 'tracking':
      return (
        <span className={styles.tracking} style={{ letterSpacing: value }}>
          Weirwood at Night
        </span>
      )
    case 'eyebrow':
      return (
        <span className={styles.eyebrow} style={{ letterSpacing: value }}>
          Design system
        </span>
      )
    case 'ease':
      return <span className={styles.ease} style={{ transitionTimingFunction: value }} />
    case 'shadow':
      return <span className={styles.shadow} style={{ boxShadow: value }} />
    case 'textShadow':
      return (
        <span className={styles.textShadow} style={{ textShadow: value }}>
          Subtitles
        </span>
      )
    case 'fade':
      return (
        <span className={styles.fade}>
          <span className={styles.fadeOver} style={{ backgroundImage: value }} />
        </span>
      )
    case 'glow':
      return (
        <span className={styles.glowGround}>
          <span className={styles.glow} style={{ opacity: value }} />
        </span>
      )
    case 'height':
      return <span className={styles.height} style={{ height: value }} />
    case 'border':
      return <span className={styles.border} style={{ borderTopWidth: value }} />
    case 'focus':
      return (
        <span className={styles.focus} style={{ outline: value }}>
          Focused
        </span>
      )
    case 'none':
      return null
    default: {
      const unknown: never = sample
      return unknown
    }
  }
}

export const TokensSection = ({ tokens }: { tokens: readonly DesignToken[] }) => (
  <DesignSection
    id="tokens"
    intro="Read straight from globals.scss, so a token added there shows up here, drawn at its true size. Component styles use only these values. Point at an easing curve to see it move."
  >
    {groupTokens(tokens).map((group) => (
      <Specimen key={group.name} name={group.name}>
        <dl className={styles.rows}>
          {group.rows.map((row) => (
            <div key={row.name} className={styles.row}>
              <dt className={styles.name}>
                <code>{row.name}</code>
              </dt>
              <dd className={styles.value}>
                <code>{row.value}</code>
                {!!row.note && <span className={styles.note}>{row.note}</span>}
              </dd>
              <dd className={styles.sample} aria-hidden="true">
                <TokenSample name={row.name} sample={row.sample} />
              </dd>
            </div>
          ))}
        </dl>
      </Specimen>
    ))}
  </DesignSection>
)
