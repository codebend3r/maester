import type { DesignToken } from '@raven/core'
import type { ComponentType } from 'react'
import { SECTION_IDS } from '@/pages/DesignPage/contents'
import { DESIGN_COPY } from '@/pages/DesignPage/copy'
import { DesignSection, Specimen } from '@/pages/DesignPage/DesignSection'
import { SAMPLES, type Sample, groupTokens } from '@/pages/DesignPage/tokenGroups'
import styles from '@/pages/DesignPage/TokensSection.module.scss'

const COPY = DESIGN_COPY.tokens

type SampleViewProps = { value: string }

type BarSampleProps = SampleViewProps

const BarSample = ({ value }: BarSampleProps) => (
  <span className={styles.bar} style={{ width: value }} />
)

type WidthSampleProps = SampleViewProps

const WidthSample = ({ value }: WidthSampleProps) => (
  <span className={styles.bar} style={{ width: `min(${value}, 100%)` }} />
)

type RadiusSampleProps = SampleViewProps

const RadiusSample = ({ value }: RadiusSampleProps) => (
  <span className={styles.radius} style={{ borderRadius: value }} />
)

type FamilySampleProps = SampleViewProps

const FamilySample = ({ value }: FamilySampleProps) => (
  <span className={styles.family} style={{ fontFamily: value }}>
    {COPY.sampleText}
  </span>
)

type SizeSampleProps = SampleViewProps

const SizeSample = ({ value }: SizeSampleProps) => (
  <span className={styles.size} style={{ fontSize: value }}>
    {COPY.sampleText}
  </span>
)

type LineSampleProps = SampleViewProps

const LineSample = ({ value }: LineSampleProps) => (
  <span className={styles.line} style={{ lineHeight: value }}>
    {COPY.lineText(COPY.sampleText)}
  </span>
)

type TrackingSampleProps = SampleViewProps

const TrackingSample = ({ value }: TrackingSampleProps) => (
  <span className={styles.tracking} style={{ letterSpacing: value }}>
    {COPY.tracking}
  </span>
)

type EyebrowSampleProps = SampleViewProps

const EyebrowSample = ({ value }: EyebrowSampleProps) => (
  <span className={styles.eyebrow} style={{ letterSpacing: value }}>
    {COPY.eyebrow}
  </span>
)

type EaseSampleProps = SampleViewProps

const EaseSample = ({ value }: EaseSampleProps) => (
  <span className={styles.ease} style={{ transitionTimingFunction: value }} />
)

type ShadowSampleProps = SampleViewProps

const ShadowSample = ({ value }: ShadowSampleProps) => (
  <span className={styles.shadow} style={{ boxShadow: value }} />
)

type TextShadowSampleProps = SampleViewProps

const TextShadowSample = ({ value }: TextShadowSampleProps) => (
  <span className={styles.textShadow} style={{ textShadow: value }}>
    {COPY.textShadow}
  </span>
)

type FadeSampleProps = SampleViewProps

const FadeSample = ({ value }: FadeSampleProps) => (
  <span className={styles.fade}>
    <span className={styles.fadeOver} style={{ backgroundImage: value }} />
  </span>
)

type GlowSampleProps = SampleViewProps

const GlowSample = ({ value }: GlowSampleProps) => (
  <span className={styles.glowGround}>
    <span className={styles.glow} style={{ opacity: value }} />
  </span>
)

type HeightSampleProps = SampleViewProps

const HeightSample = ({ value }: HeightSampleProps) => (
  <span className={styles.height} style={{ height: value }} />
)

type BorderSampleProps = SampleViewProps

const BorderSample = ({ value }: BorderSampleProps) => (
  <span className={styles.border} style={{ borderTopWidth: value }} />
)

type FocusSampleProps = SampleViewProps

const FocusSample = ({ value }: FocusSampleProps) => (
  <span className={styles.focus} style={{ outline: value }}>
    {COPY.focus}
  </span>
)

const NoSample = () => null

const SAMPLE_VIEWS = {
  [SAMPLES.bar]: BarSample,
  [SAMPLES.width]: WidthSample,
  [SAMPLES.radius]: RadiusSample,
  [SAMPLES.family]: FamilySample,
  [SAMPLES.size]: SizeSample,
  [SAMPLES.line]: LineSample,
  [SAMPLES.tracking]: TrackingSample,
  [SAMPLES.eyebrow]: EyebrowSample,
  [SAMPLES.ease]: EaseSample,
  [SAMPLES.shadow]: ShadowSample,
  [SAMPLES.textShadow]: TextShadowSample,
  [SAMPLES.fade]: FadeSample,
  [SAMPLES.glow]: GlowSample,
  [SAMPLES.height]: HeightSample,
  [SAMPLES.border]: BorderSample,
  [SAMPLES.focus]: FocusSample,
  [SAMPLES.none]: NoSample,
} as const satisfies Record<Sample, ComponentType<SampleViewProps>>

type TokenSampleProps = { name: string; sample: Sample }

/** A token drawn at its true size, read through var() so it is the live value. */
const TokenSample = ({ name, sample }: TokenSampleProps) => {
  const View = SAMPLE_VIEWS[sample]
  return <View value={`var(${name})`} />
}

type TokensSectionProps = { tokens: readonly DesignToken[] }

export const TokensSection = ({ tokens }: TokensSectionProps) => (
  <DesignSection id={SECTION_IDS.tokens} intro={COPY.intro}>
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
