import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'
import { act, waitFor } from '@testing-library/react'
import { ITEM_TYPES, type ItemDetails } from '@raven/core'
import { queryKeys } from '@/query/queryClient'
import { itemFavouriteFor } from '@/query/useItemFavourite'
import { itemDetails } from '@/test/fixtures'
import { recordingApi } from '@/test/recordingApi'
import { renderQueryHook } from '@/test/renderQueryHook'

const SHOW = itemDetails({ id: 4, type: ITEM_TYPES.show, favourite: false })

const { api } = recordingApi({ body: null })
const { useItemFavourite } = itemFavouriteFor({ api })

describe('useItemFavourite', () => {
  const spy = spyOn(api, 'setItemFavourite')

  afterEach(() => spy.mockReset())

  it("marks the item's page before the server answers, then asks the server", async () => {
    const answer = Promise.withResolvers<ItemDetails>()
    spy.mockImplementation(() => answer.promise)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(queryKeys.item(SHOW.id), SHOW)
    const { result } = renderQueryHook({ client, hook: () => useItemFavourite({ item: SHOW }) })

    act(() => result.current.mutate(true))

    await waitFor(() =>
      expect(client.getQueryData<ItemDetails>(queryKeys.item(SHOW.id))!.favourite).toBe(true),
    )
    expect(spy).toHaveBeenCalledWith({ id: SHOW.id, favourite: true })
    answer.resolve({ ...SHOW, favourite: true })
  })
})
