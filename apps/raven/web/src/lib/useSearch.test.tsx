import { describe, expect, it } from 'bun:test'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, useNavigate, useSearchParams } from 'react-router-dom'
import { useAddressSearch } from '@/lib/useSearch'

describe('useAddressSearch', () => {
  type InRouterCallbackProps = { children: ReactNode }

  const inRouter =
    (route: string) =>
    ({ children }: InRouterCallbackProps) => (
      <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
    )

  type RenderProps = { route: string; shouldWaitForEnter?: boolean }

  const render = ({ route, shouldWaitForEnter = false }: RenderProps) =>
    renderHook(
      () => ({
        search: useAddressSearch({ shouldWaitForEnter }),
        address: useSearchParams()[0].toString(),
        navigate: useNavigate(),
      }),
      { wrapper: inRouter(route) },
    )

  it('opens on the search the address carries', () => {
    const { result } = render({ route: '/?q=heat' })
    expect(result.current.search).toMatchObject({ text: 'heat', query: 'heat' })
  })

  it('writes the search into the address once it settles', async () => {
    const { result } = render({ route: '/?view=grid' })
    act(() => result.current.search.setText('heat'))
    expect(result.current.address).toBe('view=grid')
    await waitFor(() => expect(result.current.address).toBe('view=grid&q=heat'))
    act(() => result.current.search.setText(''))
    await waitFor(() => expect(result.current.address).toBe('view=grid'))
  })

  it.each(['bus', '   '])('cancels an unsubmitted draft %j when navigating home', (text) => {
    const { result } = render({ route: '/' })
    act(() => {
      result.current.search.setText(text)
      result.current.navigate('/')
    })
    expect(result.current.search).toMatchObject({ text: '', query: '' })
    expect(result.current.address).toBe('')
  })

  it('keeps a newer draft while an earlier query reaches the address', async () => {
    const { result } = render({ route: '/' })
    act(() => result.current.search.setText('bus'))
    act(() => {
      result.current.search.searchNow()
      result.current.search.setText('bust')
    })
    await waitFor(() => expect(result.current.address).toBe('q=bus'))
    expect(result.current.search).toMatchObject({ text: 'bust', query: 'bus' })
  })

  it('keeps typed whitespace when its own settled query reaches the address', async () => {
    const { result } = render({ route: '/' })
    act(() => result.current.search.setText(' bus '))
    await waitFor(() => expect(result.current.address).toBe('q=bus'))
    expect(result.current.search).toMatchObject({ text: ' bus ', query: 'bus' })
  })

  it('clears a new query when navigation home overtakes its pending address update', () => {
    const { result } = render({ route: '/' })
    act(() => {
      result.current.search.searchFor('bus')
      result.current.navigate('/')
    })
    expect(result.current.search).toMatchObject({ text: '', query: '' })
    expect(result.current.address).toBe('')
  })

  it('waits for Enter when told to, writing an emptied box into the address on its own', async () => {
    const { result } = render({ route: '/', shouldWaitForEnter: true })
    act(() => result.current.search.setText('heat'))
    await waitFor(() => expect(result.current.search.query).toBe('heat'))
    expect(result.current.address).toBe('')
    act(() => result.current.search.searchNow())
    await waitFor(() => expect(result.current.address).toBe('q=heat'))
    act(() => result.current.search.setText('heat 1995'))
    await waitFor(() => expect(result.current.search.query).toBe('heat 1995'))
    expect(result.current.address).toBe('q=heat')
    act(() => result.current.search.setText(''))
    await waitFor(() => expect(result.current.address).toBe(''))
  })

  it('takes the search from an address it did not write, as a link back to the page', () => {
    const { result } = render({ route: '/?q=heat' })
    act(() => result.current.navigate('/'))
    expect(result.current.search).toMatchObject({ text: '', query: '' })
  })
})
