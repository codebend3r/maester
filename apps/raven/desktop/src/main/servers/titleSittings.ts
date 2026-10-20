/** How the page's report of a server title (its position, its play) may go out. */
export const REPORT_KINDS = {
  /** As every page call goes, under whoever is signed in: a title main never saw opened. */
  anyone: 'anyone',
  /** Only under the account that opened the title. */
  account: 'account',
  /** Not at all: the title was opened signed out, and an account has signed in since. */
  nobody: 'nobody',
} as const

export type ReportAs =
  | { kind: typeof REPORT_KINDS.anyone }
  | { kind: typeof REPORT_KINDS.account; accountId: string }
  | { kind: typeof REPORT_KINDS.nobody }

type Title = { serverId: string; mediaId: number }

export type TitleSittings = {
  /**
   * A server title started loading. A new sitting belongs to the account signed in now; a reload
   * of the title the page still shows keeps the account that opened it.
   */
  opened: (title: Title) => void
  /** The page left the title, so its next opening is a new sitting. */
  left: (title: Title) => void
  /** A new page, which shows no title yet. */
  leftAll: () => void
  reportAs: (title: Title) => ReportAs
}

/** As every page call goes: what a report of a title main never saw opened, or no report, goes out as. */
export const AS_ANYONE: ReportAs = { kind: REPORT_KINDS.anyone }

const keyOf = ({ serverId, mediaId }: Title): string => `${serverId}/${mediaId}`

/**
 * The account each server title was opened under. A title left playing while another account
 * signs in keeps reporting its position, and that belongs to the account that opened it, never
 * the one signed in when the report goes out. The page shows one title at a time; its player
 * reloads that title (a relock, a refusal) without leaving it, so only a leave starts a new sitting.
 */
export const createTitleSittings = ({
  accountIdOf,
}: {
  accountIdOf: (input: { serverId: string }) => string | null
}): TitleSittings => {
  const sittings = new Map<string, string | null>()
  let onScreen: string | null = null

  const reportAs: TitleSittings['reportAs'] = (title) => {
    const recorded = sittings.get(keyOf(title))
    if (recorded === undefined) return AS_ANYONE
    if (recorded !== null) return { kind: REPORT_KINDS.account, accountId: recorded }
    return accountIdOf({ serverId: title.serverId }) === null
      ? AS_ANYONE
      : { kind: REPORT_KINDS.nobody }
  }

  return {
    opened: (title) => {
      const key = keyOf(title)
      if (key === onScreen && sittings.has(key)) return
      sittings.set(key, accountIdOf({ serverId: title.serverId }))
      onScreen = key
    },
    left: (title) => {
      // A leave can arrive after the next title opened; that one stays on screen.
      if (keyOf(title) === onScreen) onScreen = null
    },
    leftAll: () => {
      onScreen = null
    },
    reportAs,
  }
}
