import { describe, expect, it } from 'bun:test'

import { OWNER_DECISIONS, ownerDecisionOf, savedOwnerOf } from '@/downloads/downloadOwner'

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
