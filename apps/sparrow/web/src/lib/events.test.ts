import { describe, expect, it } from 'bun:test'
import { toChatEvent, toNotice } from '@/lib/events'

const raw = (name: string, data: unknown) => ({ name, data: JSON.stringify(data) })

describe('toChatEvent', () => {
  it('turns the server names into the page shapes', () => {
    expect(
      toChatEvent(raw('confirm', { pending_id: 3, summary: 'Replace?', action: 'replace_media' })),
    ).toEqual({
      name: 'confirm',
      confirmation: { pendingId: 3, summary: 'Replace?', action: 'replace_media' },
    })
    expect(
      toChatEvent(
        raw('choices', {
          choices: [
            { label: 'Dune', value: '438631', year: 2021, display: 'Dune (2021)' },
            { label: 1 },
          ],
        }),
      ),
    ).toEqual({
      name: 'choices',
      choices: [{ label: 'Dune', value: '438631', year: 2021, display: 'Dune (2021)', detail: '' }],
    })
    expect(
      toChatEvent(raw('tool', { name: 'search_media', input: {}, ok: true, result: '[]' })),
    ).toEqual({
      name: 'tool',
      tool: { name: 'search_media', input: {}, ok: true, result: '[]' },
    })
  })

  it('drops what it does not know or cannot read', () => {
    expect(toChatEvent(raw('mystery', {}))).toBeNull()
    expect(toChatEvent({ name: 'text', data: 'not json' })).toBeNull()
    expect(toChatEvent(raw('text', { text: 4 }))).toBeNull()
    expect(toChatEvent(raw('tool', { name: 'x' }))).toBeNull()
    expect(toChatEvent(raw('error', { ref: 'abc123' }))).toEqual({ name: 'error', ref: 'abc123' })
  })
})

describe('toNotice', () => {
  it('reads an approval with its pending action, and refuses an unknown kind', () => {
    expect(toNotice({ kind: 'approval', text: 'Dune in 4K?', pending_id: 9 })).toEqual({
      kind: 'approval',
      text: 'Dune in 4K?',
      pendingId: 9,
      to: null,
    })
    expect(toNotice({ kind: 'smoke_signal', text: 'hi' })).toBeNull()
  })
})
