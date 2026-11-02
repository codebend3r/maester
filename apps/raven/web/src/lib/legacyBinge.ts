import { api } from '@/lib/api'
import { STORE_KEYS } from '@/stores/storage'

type LegacyProfile = { account: string; ids: number[]; hasSeenTip: boolean }

const isLegacyProfile = (value: unknown): value is LegacyProfile =>
  typeof value === 'object' &&
  value !== null &&
  'account' in value &&
  typeof value.account === 'string' &&
  'hasSeenTip' in value &&
  typeof value.hasSeenTip === 'boolean' &&
  'ids' in value &&
  Array.isArray(value.ids) &&
  value.ids.every((id: unknown) => typeof id === 'number')

/** The profiles zustand's persist middleware saved before binge moved to the server. */
const legacyProfiles = (): LegacyProfile[] => {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORE_KEYS.binge) ?? 'null')
    if (typeof parsed !== 'object' || parsed === null || !('state' in parsed)) return []
    const { state } = parsed
    if (typeof state !== 'object' || state === null || !('profiles' in state)) return []
    return Array.isArray(state.profiles) ? state.profiles.filter(isLegacyProfile) : []
  } catch {
    return []
  }
}

type ForgetLegacyProps = { account: string; profiles: readonly LegacyProfile[] }

const forgetLegacy = ({ account, profiles }: ForgetLegacyProps): void => {
  const rest = profiles.filter((profile) => profile.account !== account)
  if (rest.length === 0) {
    window.localStorage.removeItem(STORE_KEYS.binge)
    return
  }
  window.localStorage.setItem(
    STORE_KEYS.binge,
    JSON.stringify({ state: { profiles: rest }, version: 0 }),
  )
}

type MoveLegacyBingeProps = { account: string }

/**
 * Moves what this browser kept for `account` before binge lived on the
 * server onto it, once, oldest first so the newest ends up first. A show the
 * server refuses (gone, locked, over the limit) is dropped.
 */
export const moveLegacyBinge = async ({ account }: MoveLegacyBingeProps): Promise<void> => {
  const profiles = legacyProfiles()
  const profile = profiles.find((entry) => entry.account === account)
  if (profile === undefined) return
  await profile.ids.toReversed().reduce(
    (previous, id) =>
      previous.then(() =>
        api.setBinge({ id, binge: true }).then(
          () => undefined,
          () => undefined,
        ),
      ),
    Promise.resolve(),
  )
  if (profile.hasSeenTip) await api.dismissBingeTip()
  forgetLegacy({ account, profiles })
}
