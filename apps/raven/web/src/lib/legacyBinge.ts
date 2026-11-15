import { type Infer, isBoolean, isNumber, isString, listOf, object } from '@raven/core'
import { api } from '@/lib/api'
import { STORE_KEYS } from '@/stores/storage'

const isLegacyProfile = object({ account: isString, ids: listOf(isNumber), hasSeenTip: isBoolean })

type LegacyProfile = Infer<typeof isLegacyProfile>

/** Anything at all: each profile is checked on its own, so a bad one is dropped alone. */
const isAny = (value: unknown): value is unknown => value !== undefined

/** What zustand's persist middleware wrote under the key. */
const isLegacyStore = object({ state: object({ profiles: listOf(isAny) }) })

/** The profiles zustand's persist middleware saved before binge moved to the server. */
const legacyProfiles = (): LegacyProfile[] => {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORE_KEYS.binge) ?? 'null')
    return isLegacyStore(parsed) ? parsed.state.profiles.filter(isLegacyProfile) : []
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
