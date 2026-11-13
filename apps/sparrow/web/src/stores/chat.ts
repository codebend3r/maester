import { create } from 'zustand'
import { type StateStorage, createJSONStorage, devtools, persist } from 'zustand/middleware'
import { type CaseTurn, ROUTES, type Turn, decide, forget, streamTurn } from '@/lib/api'
import { CHAT_COPY } from '@/lib/copy'
import {
  ENTRY_KINDS,
  type Entry,
  type ReplyEntry,
  SAVED_CHAT_VERSION,
  type SavedChat,
  dropOlderSave,
  isFinished,
  toSavedChat,
} from '@/lib/entries'
import type { Choice } from '@/lib/events'

/** The pre-sparrow key, kept from the rebrand; a save older than `SAVED_CHAT_VERSION` is dropped, not read. */
export const CHAT_STORAGE_KEY = 'luwin-chat'

/** The browser's storage, or nothing when it is refused (a locked-down private window). */
const quietStorage: StateStorage = {
  getItem: (name) => {
    try {
      return window.localStorage.getItem(name)
    } catch {
      return null
    }
  },
  setItem: (name, value) => {
    try {
      window.localStorage.setItem(name, value)
    } catch {
      // Storage refused: the conversation lasts this visit only.
    }
  },
  removeItem: (name) => {
    try {
      window.localStorage.removeItem(name)
    } catch {
      // Nothing was kept to remove.
    }
  },
}

type SendProps = { text: string; expected?: CaseTurn }

type PressProps = { pendingId: number; approve: boolean }

type ChatState = {
  /** Whose conversation this is: the sandbox world's id, or the signed-in user's. */
  owner: string | null
  entries: Entry[]
  /** Pending actions whose buttons are spent. */
  settled: number[]
  isBusy: boolean
  send: (message: SendProps) => Promise<void>
  pick: (choice: Choice) => Promise<void>
  press: (press: PressProps) => Promise<void>
  /** Forgets the conversation on the server, then clears the page; keeps it when that fails. */
  startOver: () => Promise<void>
  /**
   * Takes up `owner`'s conversation: the saved one when it is theirs, else a fresh page,
   * since the server holds no other (a new sandbox world, someone else signed in).
   */
  adopt: (owner: string) => void
}

type WithNoteProps = { entries: Entry[]; text: string }

/** `entries` with a decision appended that sent nothing: the page's own word on a press. */
const withNote = ({ entries, text }: WithNoteProps): Entry[] => [
  ...entries,
  { kind: ENTRY_KINDS.decision, id: entries.length, text, events: [] },
]

/**
 * The conversation on this page, kept across reloads. Entry ids are their indexes:
 * entries are only appended.
 */
export const useChat = create<ChatState>()(
  devtools(
    persist(
      (set, get) => {
        type UpdateReplyProps = { id: number; change: (reply: ReplyEntry) => ReplyEntry }

        const updateReply = ({ id, change }: UpdateReplyProps) =>
          set(({ entries }) => ({
            entries: entries.map((entry) =>
              entry.id === id && entry.kind === ENTRY_KINDS.reply ? change(entry) : entry,
            ),
          }))

        type RunTurnProps = { said: string; turn: Turn; expected: CaseTurn | null }

        const runTurn = async ({ said, turn, expected }: RunTurnProps) => {
          const start = get().entries.length
          const reply: ReplyEntry = {
            kind: ENTRY_KINDS.reply,
            id: start + 1,
            events: [],
            failure: null,
            expected,
          }
          set(({ entries }) => ({
            isBusy: true,
            entries: [...entries, { kind: ENTRY_KINDS.said, id: start, text: said }, reply],
          }))
          try {
            await streamTurn({
              turn,
              onEvent: (event) =>
                updateReply({
                  id: reply.id,
                  change: (r) => ({ ...r, events: [...r.events, event] }),
                }),
            })
          } catch {
            updateReply({
              id: reply.id,
              change: (r) => ({ ...r, failure: CHAT_COPY.unreachable }),
            })
          } finally {
            // A stream that ended without `done` or `error` was cut off.
            updateReply({
              id: reply.id,
              change: (r) =>
                r.failure === null && !isFinished(r.events)
                  ? { ...r, failure: CHAT_COPY.cutOff }
                  : r,
            })
            set({ isBusy: false })
          }
        }

        return {
          owner: null,
          entries: [],
          settled: [],
          isBusy: false,
          send: ({ text, expected }) =>
            runTurn({
              said: text,
              turn: { route: ROUTES.chat, body: { text } },
              expected: expected ?? null,
            }),
          pick: (choice) =>
            runTurn({
              said: choice.display,
              turn: {
                route: ROUTES.pick,
                body: { label: choice.label, value: choice.value, year: choice.year },
              },
              expected: null,
            }),
          press: async ({ pendingId, approve }) => {
            set({ isBusy: true })
            const decision = await decide({ pendingId, approve }).catch(() => null)
            set(({ entries, settled }) => {
              if (!decision) {
                return {
                  isBusy: false,
                  entries: withNote({ entries, text: CHAT_COPY.unreachable }),
                }
              }
              return {
                isBusy: false,
                settled: decision.isSettled ? [...settled, pendingId] : settled,
                entries: [
                  ...entries,
                  {
                    kind: ENTRY_KINDS.decision,
                    id: entries.length,
                    text: decision.text,
                    events: decision.events,
                  },
                ],
              }
            })
          },
          startOver: async () => {
            set({ isBusy: true })
            const isForgotten = await forget().then(
              () => true,
              () => false,
            )
            if (isForgotten) {
              set({ entries: [], settled: [], isBusy: false })
              return
            }
            set(({ entries }) => ({
              isBusy: false,
              entries: withNote({ entries, text: CHAT_COPY.notForgotten }),
            }))
          },
          adopt: (owner) => {
            if (get().owner === owner) return
            set({ owner, entries: [], settled: [] })
          },
        }
      },
      {
        name: CHAT_STORAGE_KEY,
        version: SAVED_CHAT_VERSION,
        storage: createJSONStorage(() => quietStorage),
        partialize: ({ owner, entries, settled }): Partial<SavedChat> => ({
          ...(owner === null ? {} : { owner }),
          entries,
          settled,
        }),
        migrate: dropOlderSave,
        merge: (saved, current) => ({ ...current, ...toSavedChat(saved) }),
      },
    ),
    { name: 'sparrow/chat' },
  ),
)
