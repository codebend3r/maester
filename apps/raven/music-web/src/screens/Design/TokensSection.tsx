import type { ComponentType } from 'react'
import { DESIGN_COPY } from '@raven/wren'
import { DesignSection, TokenLine } from '@/screens/Design/DesignSection'
import { designTokens } from '@/screens/Design/designTokens'
import { SECTION_IDS } from '@/screens/Design/sections'
import { SAMPLES, type Sample, groupTokens } from '@/screens/Design/tokenGroups'
import styles from '@/screens/Design/Design.module.scss'

const COPY = DESIGN_COPY.tokens

type SampleViewProps = { name: string }

function BarSample({ name }: SampleViewProps) {
  return <span className={styles.bar} style={{ width: `min(var(${name}), 100%)` }} />
}

function RadiusSample({ name }: SampleViewProps) {
  return <span className={styles.radius} style={{ borderRadius: `var(${name})` }} />
}

function FamilySample({ name }: SampleViewProps) {
  return (
    <span className={styles.family} style={{ fontFamily: `var(${name})` }}>
      {COPY.sampleText}
    </span>
  )
}

function WeightSample({ name }: SampleViewProps) {
  return (
    <span className={styles.family} style={{ fontWeight: `var(${name})` }}>
      {COPY.sampleText}
    </span>
  )
}

function SizeSample({ name }: SampleViewProps) {
  return (
    <span className={styles.size} style={{ fontSize: `var(${name})` }}>
      {COPY.sampleText}
    </span>
  )
}

function LineSample({ name }: SampleViewProps) {
  return (
    <span className={styles.line} style={{ lineHeight: `var(${name})` }}>
      {COPY.lineText(COPY.sampleText)}
    </span>
  )
}

function TrackingSample({ name }: SampleViewProps) {
  return (
    <span className={styles.family} style={{ letterSpacing: `var(${name})` }}>
      {COPY.tracking}
    </span>
  )
}

function ShadowSample({ name }: SampleViewProps) {
  return <span className={styles.shadow} style={{ boxShadow: `var(${name})` }} />
}

function NoSample() {
  return null
}

const SAMPLE_VIEWS = {
  [SAMPLES.bar]: BarSample,
  [SAMPLES.radius]: RadiusSample,
  [SAMPLES.family]: FamilySample,
  [SAMPLES.weight]: WeightSample,
  [SAMPLES.size]: SizeSample,
  [SAMPLES.line]: LineSample,
  [SAMPLES.tracking]: TrackingSample,
  [SAMPLES.shadow]: ShadowSample,
  [SAMPLES.none]: NoSample,
} as const satisfies Record<Sample, ComponentType<SampleViewProps>>

const GROUPS = groupTokens(designTokens)

/** Every token but the colours and type styles, at its true size beside its value. */
export function TokensSection() {
  return (
    <DesignSection id={SECTION_IDS.tokens} intro={COPY.intro}>
      {GROUPS.map((group) => (
        <section aria-label={group.name} className={styles.group} key={group.name}>
          <h3 className={styles.groupName}>{group.name}</h3>
          <ul aria-label={group.name} className={styles.tokens}>
            {group.rows.map((row) => {
              const Sample = SAMPLE_VIEWS[row.sample]
              return (
                <TokenLine key={row.name} token={row}>
                  <Sample name={row.name} />
                </TokenLine>
              )
            })}
          </ul>
        </section>
      ))}
    </DesignSection>
  )
}
