import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryView, type QueryRead, keptRead } from '@/components/QueryView/QueryView'

type ShowProps = { query: QueryRead<readonly string[]>; hasEmpty?: boolean }

const show = ({ query, hasEmpty = true }: ShowProps) =>
  render(
    <QueryView
      query={query}
      pending={<p>Reading</p>}
      renderFailed={(error) => <p role="alert">{error.message}</p>}
      {...(hasEmpty
        ? {
            empty: {
              isEmpty: (names: readonly string[]) => names.length === 0,
              shown: <p>Nothing yet</p>,
            },
          }
        : {})}
    >
      {(names) => <p>{names.join(', ')}</p>}
    </QueryView>,
  )

describe('QueryView', () => {
  afterEach(cleanup)

  it('says why a read failed', () => {
    show({ query: { isError: true, error: new Error('The server is away.') } })
    expect(screen.getByRole('alert').textContent).toBe('The server is away.')
  })

  it('shows its stand-in while the read is on its way', () => {
    show({ query: { isError: false, isPending: true } })
    expect(screen.getByText('Reading')).toBeTruthy()
  })

  it('says so when the answer holds nothing', () => {
    show({ query: { isError: false, isPending: false, data: [] } })
    expect(screen.getByText('Nothing yet')).toBeTruthy()
  })

  it('shows the answer, and an empty one too when nothing counts as empty', () => {
    show({ query: { isError: false, isPending: false, data: ['Dune', 'Heat'] } })
    expect(screen.getByText('Dune, Heat')).toBeTruthy()
    cleanup()
    show({ query: { isError: false, isPending: false, data: [] }, hasEmpty: false })
    expect(screen.queryByText('Nothing yet')).toBeNull()
  })

  it('keeps what a read last answered over a later failure', () => {
    const failure = new Error('The server is away.')
    expect(keptRead({ data: ['Dune'], error: failure })).toEqual({
      isError: false,
      isPending: false,
      data: ['Dune'],
    })
    expect(keptRead({ data: undefined, error: failure })).toEqual({ isError: true, error: failure })
    expect(keptRead({ data: undefined, error: null })).toEqual({ isError: false, isPending: true })
  })
})
