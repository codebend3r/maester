import { LIBRARY_WORK_KINDS, type LibraryWorkKind } from '@raven/core'
import { useServerActiveWork } from '@raven/ui/headless'

import { SettingsButton, SettingsLine, SettingsSection } from '@/layouts'
import type { AppQueries } from '@/queries/useAppQueries'
import { ADMIN_COPY, LIBRARY_ACTIONS_COPY } from '@/screens/adminCopy'

const WORK_LABELS = {
  [LIBRARY_WORK_KINDS.quickScan]: LIBRARY_ACTIONS_COPY.quickScan,
  [LIBRARY_WORK_KINDS.fullScan]: LIBRARY_ACTIONS_COPY.fullScan,
  [LIBRARY_WORK_KINDS.ratings]: ADMIN_COPY.ratingsWork,
} as const satisfies Record<LibraryWorkKind, string>

type AdminLibrariesProps = { session: AppQueries }

/**
 * Admin's Library scans, as the web's Settings has it: what runs across every library and the
 * one press that stops it all, read again every two seconds while open. Each library's own
 * scans are on its card on the Libraries page, as on the web.
 */
export const AdminLibraries = ({ session: { api, queries } }: AdminLibrariesProps) => {
  const { state, running, cancel, error } = useServerActiveWork({
    api,
    librariesQuery: queries.librariesQuery,
  })
  return (
    <SettingsSection note={ADMIN_COPY.scansHint} title={ADMIN_COPY.scans}>
      {state.data !== undefined && running.length === 0 && (
        <SettingsLine text={ADMIN_COPY.noScans} />
      )}
      {running.map(({ library, kind }) => (
        <SettingsLine
          key={`${library.id}-${kind}`}
          text={ADMIN_COPY.running({ library: library.name, work: WORK_LABELS[kind] })}
        />
      ))}
      {state.data !== undefined && (
        <SettingsButton
          isDisabled={cancel.isPending || running.length === 0}
          onPress={() => cancel.mutate()}
          text={ADMIN_COPY.stopScans}
        />
      )}
      {error !== null && <SettingsLine isAlert text={error.message} />}
    </SettingsSection>
  )
}
