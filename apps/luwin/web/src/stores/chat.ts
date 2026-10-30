import { create } from 'zustand'
import { type StateStorage, createJSONStorage, devtools, persist } from 'zustand/middleware'
import { type CaseTurn, type ChatRoute, ROUTES, decide, forget, streamTurn } from '@/lib/api'
import {
  ENTRY_KINDS,
  type Entry,
  REPLY_STATES,
  type Reply,
  type SavedChat,
  toSavedChat,
} from '@/lib/entries'
import { CHAT_EVENTS, type ChatEvent, type Choice } from '@/lib/events'
import { CHAT_COPY } from '@/stores/copy'

/** Where the conversation is kept between visits, in this browser only. */
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

const UNREACHABLE = "Couldn't reach luwin; check that its server or the sandbox is running."

type ApplyEventProps = { reply: Reply; event: ChatEvent }

/** `reply` with one more of its stream's events applied. */
const applyEvent = ({ reply, event }: ApplyEventProps): Reply => {
  switch (event.name) {
    case CHAT_EVENTS.tool:
      return { ...reply, tools: [...reply.tools, event.tool] }
    case CHAT_EVENTS.text:
      return { ...reply, chunks: [...reply.chunks, event.text] }
    case CHAT_EVENTS.confirm:
      return { ...reply, confirmations: [...reply.confirmations, event.confirmation] }
    case CHAT_EVENTS.choices:
      return { ...reply, choices: event.choices }
    case CHAT_EVENTS.titles:
      return { ...reply, titles: [...reply.titles, ...event.titles] }
    case CHAT_EVENTS.notice:
      return { ...reply, notices: [...reply.notices, event.notice] }
    case CHAT_EVENTS.failure:
      return { ...reply, cause: event.detail }
    case CHAT_EVENTS.done:
      return { ...reply, state: REPLY_STATES.done }
    case CHAT_EVENTS.error:
      return {
        ...reply,
        state: REPLY_STATES.failed,
        failure: CHAT_COPY.broke(event.ref),
      }
    default: {
      const unknown: never = event
      return unknown
    }
  }
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
  /** Forgets the conversation on the server, then clears the page. */
  startOver: () => Promise<void>
  /**
   * Takes up `owner`'s conversation: the saved one when it is theirs, else a fresh page,
   * since the server holds no other (a new sandbox world, someone else signed in).
   */
  adopt: (owner: string) => void
}

/**
 * The conversation on this page, kept across reloads. Entry ids are their indexes:
 * entries are only appended.
 */
export const useChat = create<ChatState>()(
  devtools(
    persist(
      (set, get) => {
        type UpdateReplyProps = { id: number; change: (reply: Reply) => Reply }

        const updateReply = ({ id, change }: UpdateReplyProps) =>
          set(({ entries }) => {
            const entry = entries[id]
            return entry?.kind === ENTRY_KINDS.reply
              ? { entries: entries.with(id, change(entry)) }
              : {}
          })

        type RunTurnProps = {
          said: string
          route: ChatRoute
          body: Record<string, unknown>
          expected: CaseTurn | null
        }

        const runTurn = async ({ said, route, body, expected }: RunTurnProps) => {
          const start = get().entries.length
          const reply: Reply = {
            kind: ENTRY_KINDS.reply,
            id: start + 1,
            state: REPLY_STATES.running,
            chunks: [],
            tools: [],
            confirmations: [],
            choices: [],
            notices: [],
            titles: [],
            failure: null,
            cause: null,
            expected,
          }
          set(({ entries }) => ({
            isBusy: true,
            entries: [...entries, { kind: ENTRY_KINDS.said, id: start, text: said }, reply],
          }))
          try {
            await streamTurn({
              route,
              body,
              onEvent: (event) =>
                updateReply({ id: reply.id, change: (r) => applyEvent({ reply: r, event }) }),
            })
          } catch {
            updateReply({
              id: reply.id,
              change: (r) => ({ ...r, state: REPLY_STATES.failed, failure: UNREACHABLE }),
            })
          } finally {
            // A stream that ended without `done` or `error` was cut off.
            updateReply({
              id: reply.id,
              change: (r) =>
                r.state === REPLY_STATES.running
                  ? { ...r, state: REPLY_STATES.failed, failure: CHAT_COPY.cutOff }
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
            runTurn({ said: text, route: ROUTES.chat, body: { text }, expected: expected ?? null }),
          pick: (choice) =>
            runTurn({
              said: choice.display,
              route: ROUTES.pick,
              body: { label: choice.label, value: choice.value, year: choice.year },
              expected: null,
            }),
          press: async ({ pendingId, approve }) => {
            set({ isBusy: true })
            const decision = await decide({ pendingId, approve }).catch(() => null)
            set(({ entries, settled }) => ({
              isBusy: false,
              settled: decision?.isSettled ? [...settled, pendingId] : settled,
              entries: [
                ...entries,
                {
                  kind: ENTRY_KINDS.decision,
                  id: entries.length,
                  text: decision?.text ?? UNREACHABLE,
                  notices: decision?.notices ?? [],
                },
              ],
            }))
          },
          startOver: async () => {
            set({ isBusy: true })
            await forget().catch(() => null)
            set({ entries: [], settled: [], isBusy: false })
          },
          adopt: (owner) => {
            if (get().owner === owner) return
            set({ owner, entries: [], settled: [] })
          },
        }
      },
      {
        name: CHAT_STORAGE_KEY,
        storage: createJSONStorage(() => quietStorage),
        partialize: ({ owner, entries, settled }): Partial<SavedChat> => ({
          ...(owner == null ? {} : { owner }),
          entries,
          settled,
        }),
        merge: (saved, current) => ({ ...current, ...toSavedChat(saved) }),
      },
    ),
    { name: 'luwin/chat' },
  ),
)
