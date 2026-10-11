import type { CSSProperties } from 'react'
import type { DesignToken, TokenGroup } from '@/lib/tokens'
import { DesignSection, Specimen } from '@/pages/DesignPage/DesignSection'
import styles from '@/pages/DesignPage/DesignPage.module.scss'

const SAMPLE = 'The raven reads every folder'

/** Each group's name and how a token in it is shown at true size. */
const GROUPS: Array<{
  group: Exclude<TokenGroup, 'colour'>
  name: string
  sample: (name: string) => { className: string; style: CSSProperties; text?: string }
}> = [
  {
    group: 'space',
    name: 'Spacing',
    sample: (name) => ({ className: styles.spaceBar, style: { width: `var(${name})` } }),
  },
  {
    group: 'radius',
    name: 'Radius',
    sample: (name) => ({ className: styles.radiusBox, style: { borderRadius: `var(${name})` } }),
  },
  {
    group: 'font',
    name: 'Typefaces',
    sample: (name) => ({
      className: styles.typeSample,
      style: { fontFamily: `var(${name})` },
      text: SAMPLE,
    }),
  },
  {
    group: 'font-size',
    name: 'Type scale',
    sample: (name) => ({
      className: styles.typeSample,
      style: { fontSize: `var(${name})` },
      text: SAMPLE,
    }),
  },
  {
    group: 'line',
    name: 'Line height',
    sample: (name) => ({
      className: styles.lineSample,
      style: { lineHeight: `var(${name})` },
      text: `${SAMPLE}, then waits for the next one, and the next.`,
    }),
  },
  {
    group: 'other',
    name: 'Layout and focus',
    sample: (name) => ({
      className: name === '--focus-ring' ? styles.focusSample : styles.noSample,
      style: name === '--focus-ring' ? { outline: `var(${name})` } : {},
    }),
  },
]

export const TokensSection = ({ tokens }: { tokens: readonly DesignToken[] }) => (
  <DesignSection
    id="tokens"
    title="Tokens"
    intro="Read straight from globals.scss, so a token added there shows up here. Component styles use only these values."
  >
    {GROUPS.map(({ group, name, sample }) => {
      const members = tokens.filter((token) => token.group === group)
      return (
        members.length > 0 && (
          <Specimen key={group} name={name}>
            <table className={styles.tokenTable}>
              <thead>
                <tr>
                  <th scope="col">Token</th>
                  <th scope="col">Value</th>
                  <th scope="col">Sample</th>
                </tr>
              </thead>
              <tbody>
                {members.map((token) => {
                  const shown = sample(token.name)
                  return (
                    <tr key={token.name}>
                      <th scope="row">
                        <code>{token.name}</code>
                      </th>
                      <td>
                        <code className={styles.tokenValue}>{token.value}</code>
                        {!!token.note && <span className={styles.rowNote}>{token.note}</span>}
                      </td>
                      <td>
                        <span className={shown.className} style={shown.style}>
                          {shown.text}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Specimen>
        )
      )
    })}
  </DesignSection>
)
