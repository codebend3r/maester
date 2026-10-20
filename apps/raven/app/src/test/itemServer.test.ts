import { describe, expect, it } from 'bun:test'
import { WATCH_TARGET_KINDS } from '@raven/core'

import { BUSBOYS_FILE, itemApi } from '@/test/itemServer'

describe('itemApi', () => {
  it('takes a watched change as the server does, answering with no content', async () => {
    const change = {
      watched: true,
      targets: [{ kind: WATCH_TARGET_KINDS.media, id: BUSBOYS_FILE.id }],
    }
    expect(await itemApi().setWatched(change)).toBeUndefined()
  })
})
