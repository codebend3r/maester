import { serverNameFor } from '@raven/core'
import { Section } from '@/pages/SettingsPage/Section'
import { SETTINGS_COPY } from '@/pages/SettingsPage/copy'
import { serverOrigin } from '@/lib/apiOrigin'
import styles from '@/pages/SettingsPage/SettingsPage.module.scss'

/**
 * Where the media comes from: the one server this app holds, named and
 * linked, until a later change lets a viewer keep several and switch. Not
 * in Raven, whose page reaches its server through a loopback host it would
 * name instead.
 */
export const ServerSection = () => {
  const origin = serverOrigin()
  return (
    <Section icon="globe" title={SETTINGS_COPY.server.heading} help={SETTINGS_COPY.server.help}>
      <dl className={styles.facts}>
        <dt>{SETTINGS_COPY.server.name}</dt>
        <dd>{serverNameFor(origin)}</dd>
        <dt>{SETTINGS_COPY.server.address}</dt>
        <dd>
          <a href={origin}>{origin}</a>
        </dd>
      </dl>
      <p className={styles.hint}>{SETTINGS_COPY.server.later}</p>
    </Section>
  )
}
