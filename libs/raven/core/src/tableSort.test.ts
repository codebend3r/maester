import { describe, expect, it } from 'bun:test'
import { type SortColumn, nextSort, sortRows } from '@/tableSort'

type Row = { name: string; score: number | null }
const columns: Record<'name' | 'score', SortColumn<Row>> = {
  name: { value: (row) => row.name, first: 'asc' },
  score: { value: (row) => row.score, first: 'desc' },
}
const rows: Row[] = [
  { name: 'b', score: 2 },
  { name: 'a', score: null },
  { name: 'c', score: 9 },
]

describe('sortRows', () => {
  it('keeps the given order with nothing active, and sorts either way with a missing value last', () => {
    expect(sortRows({ rows, columns, active: null }).map((row) => row.name)).toEqual([
      'b',
      'a',
      'c',
    ])
    expect(
      sortRows({ rows, columns, active: { key: 'score', direction: 'desc' } }).map((r) => r.name),
    ).toEqual(['c', 'b', 'a'])
    expect(
      sortRows({ rows, columns, active: { key: 'score', direction: 'asc' } }).map((r) => r.name),
    ).toEqual(['b', 'c', 'a'])
    expect(
      sortRows({ rows, columns, active: { key: 'name', direction: 'asc' } }).map((r) => r.name),
    ).toEqual(['a', 'b', 'c'])
  })
})

describe('nextSort', () => {
  it("goes to the column's first direction, then the other, then off", () => {
    const first = nextSort<'score'>({ active: null, key: 'score', first: 'desc' })
    expect(first).toEqual({ key: 'score', direction: 'desc' })
    const second = nextSort({ active: first, key: 'score', first: 'desc' })
    expect(second).toEqual({ key: 'score', direction: 'asc' })
    expect(nextSort({ active: second, key: 'score', first: 'desc' })).toBeNull()
  })
})
