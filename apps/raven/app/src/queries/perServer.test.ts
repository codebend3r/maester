import { describe, expect, it } from 'bun:test'

import { lastPerServer } from '@/queries/perServer'
import { NAS } from '@/test/homeServer'

const OTHER = { ...NAS, id: '5d3c2b1a-0f9e-4d8c-b7a6-958473625140', origin: 'http://other:8484' }

describe('lastPerServer', () => {
  it('makes one value per server and hands the same one back while it stays active', () => {
    const made: string[] = []
    const valueFor = lastPerServer((server) => {
      made.push(server.id)
      return { origin: server.origin }
    })
    const first = valueFor(NAS)
    expect(valueFor(NAS)).toBe(first)
    expect(valueFor(OTHER)).toEqual({ origin: OTHER.origin })
    expect(valueFor(NAS)).not.toBe(first)
    expect(made).toEqual([NAS.id, OTHER.id, NAS.id])
  })
})
