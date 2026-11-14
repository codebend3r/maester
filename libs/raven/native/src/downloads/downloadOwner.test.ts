import { describe, expect, it } from 'bun:test'

import {
  OWNER_DECISIONS,
  keepForOwner,
  ownerDecisionOf,
  savedOwnerOf,
} from '@/downloads/downloadOwner'

describe('ownerDecisionOf', () => {
  it('keeps them signed out and for their owner', () => {
    expect(ownerDecisionOf({ ownerId: 'ana', accountId: null })).toBe(OWNER_DECISIONS.keep)
    expect(ownerDecisionOf({ ownerId: null, accountId: null })).toBe(OWNER_DECISIONS.keep)
    expect(ownerDecisionOf({ ownerId: 'ana', accountId: 'ana' })).toBe(OWNER_DECISIONS.keep)
  })

  it('lets the first account claim downloads that have no owner', () => {
    expect(ownerDecisionOf({ ownerId: null, accountId: 'ana' })).toBe(OWNER_DECISIONS.claim)
  })

  it("replaces another account's downloads", () => {
    expect(ownerDecisionOf({ ownerId: 'ana', accountId: 'ben' })).toBe(OWNER_DECISIONS.replace)
  })
})

describe('savedOwnerOf', () => {
  it('reads the owner a store saved, and none from an older store that kept none', () => {
    expect(savedOwnerOf({ ownerId: 'ana', entries: {} })).toBe('ana')
    expect(savedOwnerOf({ entries: {} })).toBeNull()
    expect(savedOwnerOf({ ownerId: 4 })).toBeNull()
    expect(savedOwnerOf(null)).toBeNull()
  })
})

describe('keepForOwner', () => {
  type Run = { removed: number; owners: (string | null)[] }

  type RunForProps = { ownerId: string | null; accountId: string | null }

  const runFor = async ({ ownerId, accountId }: RunForProps) => {
    const run: Run = { removed: 0, owners: [] }
    const isRemoved = await keepForOwner({
      ownerId,
      accountId,
      removeAll: async () => {
        run.removed += 1
      },
      own: (owner) => {
        run.owners.push(owner)
      },
    })
    return { isRemoved, ...run }
  }

  it('keeps them for their owner and signed out, writing nothing', async () => {
    expect(await runFor({ ownerId: 'ana', accountId: 'ana' })).toEqual({
      isRemoved: false,
      removed: 0,
      owners: [],
    })
    expect(await runFor({ ownerId: 'ana', accountId: null })).toEqual({
      isRemoved: false,
      removed: 0,
      owners: [],
    })
  })

  it('claims downloads that have no owner without removing them', async () => {
    expect(await runFor({ ownerId: null, accountId: 'ana' })).toEqual({
      isRemoved: false,
      removed: 0,
      owners: ['ana'],
    })
  })

  it("removes another account's downloads and hands them over", async () => {
    expect(await runFor({ ownerId: 'ana', accountId: 'ben' })).toEqual({
      isRemoved: true,
      removed: 1,
      owners: ['ben'],
    })
  })
})
