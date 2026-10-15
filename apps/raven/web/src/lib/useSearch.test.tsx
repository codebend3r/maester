import { describe, expect, it } from 'bun:test'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, useNavigate, useSearchParams } from 'react-router-dom'
import { useAddressSearch, useSearch } from '@/lib/useSearch'

describe('useSearch', () => {
  it('asks for what is typed only once typing pauses, never for each keystroke', async () => {
    const asked: string[] = []
    const { result } = renderHook(() => {
      const search = useSearch()
      asked.push(search.query)
      return search
    })
    act(() => result.current.setText('h'))
    act(() => result.current.setText('he'))
    act(() => result.current.setText('heat '))
    expect(result.current.text).toBe('heat ')
    expect(result.current.query).toBe('')
    await waitFor(() => expect(result.current.query).toBe('heat'))
    expect([...new Set(asked)]).toEqual(['', 'heat'])
  })

  it('asks at once when told to, as Enter does', () => {
    const { result } = renderHook(() => useSearch({ initial: 'heat' }))
    expect(result.current.query).toBe('heat')
    act(() => result.current.setText('heat 1995'))
    act(() => result.current.searchNow())
    expect(result.current.query).toBe('heat 1995')
  })

  it('takes a search set from outside the box at once', () => {
    const { result } = renderHook(() => useSearch({ initial: 'heat' }))
    act(() => result.current.searchFor(''))
    expect(result.current).toMatchObject({ text: '', query: '' })
  })
})

describe('useAddressSearch', () => {
  const inRouter =
    (route: string) =>
    ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
    )

  const render = (route: string) =>
    renderHook(
      () => ({
        search: useAddressSearch(),
        address: useSearchParams()[0].toString(),
        navigate: useNavigate(),
      }),
      { wrapper: inRouter(route) },
    )

  it('opens on the search the address carries', () => {
    const { result } = render('/?q=heat')
    expect(result.current.search).toMatchObject({ text: 'heat', query: 'heat' })
  })

  it('writes the search into the address once it settles', async () => {
    const { result } = render('/?view=grid')
    act(() => result.current.search.setText('heat'))
    expect(result.current.address).toBe('view=grid')
    await waitFor(() => expect(result.current.address).toBe('view=grid&q=heat'))
    act(() => result.current.search.setText(''))
    await waitFor(() => expect(result.current.address).toBe('view=grid'))
  })

  it('takes the search from an address it did not write, as a link back to the page', () => {
    const { result } = render('/?q=heat')
    act(() => result.current.navigate('/'))
    expect(result.current.search).toMatchObject({ text: '', query: '' })
  })
})
