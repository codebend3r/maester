import { describe, expect, it } from 'bun:test'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useSearch } from '@/lib/useSearch'

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
