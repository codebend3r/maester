import { spyOn } from 'bun:test'
import { BINGE_LIMIT, type BingeState } from '@raven/core'
import { api } from '@/lib/api'

type FakeBingeProps = { ids?: number[]; hasSeenTip?: boolean }

/**
 * Stands in for the server's binge list: the api's binge calls answer from
 * one list that `setBinge` and `dismissBingeTip` change, as the server does.
 * Call `restore` after the test.
 */
export const fakeBinge = ({ ids = [], hasSeenTip = false }: FakeBingeProps = {}) => {
  const held = { state: { ids, hasSeenTip } satisfies BingeState }
  const get = spyOn(api, 'getBinge').mockImplementation(async () => held.state)
  const set = spyOn(api, 'setBinge').mockImplementation(async ({ id, binge }) => {
    const rest = held.state.ids.filter((entry) => entry !== id)
    if (binge && rest.length >= BINGE_LIMIT && !held.state.ids.includes(id)) {
      throw new Error('full')
    }
    held.state = {
      ids: binge ? [id, ...rest] : rest,
      hasSeenTip: held.state.hasSeenTip || binge,
    }
    return held.state
  })
  const dismiss = spyOn(api, 'dismissBingeTip').mockImplementation(async () => {
    held.state = { ...held.state, hasSeenTip: true }
    return held.state
  })
  return {
    get,
    set,
    dismiss,
    state: () => held.state,
    restore: () => [get, set, dismiss].forEach((spy) => spy.mockRestore()),
  }
}
