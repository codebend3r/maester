import { isTrackIndex } from '@raven/core'
import { MPV_CHOICES, MPV_PROPERTIES, type MpvOption, type MpvTrack } from '@raven/mpv'
import type { MpvControl } from '@/main/player/guardedMpv'
import { OK, type PlayerOutcome, refuse } from '@/main/player/outcomes'
import { PLAYER_MESSAGES } from '@/main/player/playerMessages'
import type { createQuietMpv } from '@/main/player/quietMpv'
import type { Title, Wanted } from '@/main/player/titleState'
import { aidFor, sidFor } from '@/main/player/tracksFromMpv'

type CreateTrackPicksProps = {
  mpv: MpvControl
  quiet: Pick<ReturnType<typeof createQuietMpv>, 'readOr' | 'set'>
  /** The open file's tracks; none while no file is loaded. */
  trackList: () => readonly MpvTrack[]
  /** The title on screen, or null. */
  title: () => Title | null
  /** Whether the title is still opening, so a pick waits for its snapshot. */
  isLoading: () => boolean
  /** Keeps a pick with the title on screen. */
  keep: (wanted: Partial<Wanted>) => void
  /** The service's epoch, so a pick overtaken while mpv answered is not kept. */
  epoch: () => number
  overtaken: () => PlayerOutcome
}

type PickProps = {
  wanted: Partial<Wanted>
  /** What mpv is set to for the pick, or null when the file has no such track. */
  choice: () => MpvOption | null
}

type SelectLateSubtitleProps = { pending: Promise<boolean>; token: number; id: string }

/** The page's audio and subtitle picks, kept with the title and set on mpv once its file is open. */
export const createTrackPicks = ({
  mpv,
  quiet,
  trackList,
  title,
  isLoading,
  keep,
  epoch,
  overtaken,
}: CreateTrackPicksProps) => {
  // Bumped as each subtitle pick starts, before mpv hears it, so a late sidecar can tell a pick on its way.
  let subtitlePicks = 0

  const aidOf = (index: number | null) => {
    if (index === null || !isTrackIndex(index)) return MPV_CHOICES.auto
    return aidFor({ list: trackList(), index }) ?? MPV_CHOICES.auto
  }

  const sidOf = (id: string | null) => {
    if (id === null) return MPV_CHOICES.no
    return sidFor({ list: trackList(), id }) ?? MPV_CHOICES.no
  }

  /** Picks a track: kept for the snapshot while the file opens, else set and then kept. */
  const pick = async ({ wanted, choice }: PickProps): Promise<PlayerOutcome> => {
    if (title() === null) return refuse(PLAYER_MESSAGES.noTrack)
    if (isLoading()) {
      keep(wanted)
      return OK
    }
    const option = choice()
    if (option === null) return refuse(PLAYER_MESSAGES.noTrack)
    const token = epoch()
    await mpv.set(option)
    if (token !== epoch()) return overtaken()
    keep(wanted)
    return OK
  }

  const audio = async (index: number | null): Promise<PlayerOutcome> => {
    if (index !== null && !isTrackIndex(index)) return refuse(PLAYER_MESSAGES.noTrack)
    return pick({
      wanted: { audio: index },
      choice: () => {
        const aid = index === null ? MPV_CHOICES.auto : aidFor({ list: trackList(), index })
        return aid === null ? null : { name: MPV_PROPERTIES.aid, value: aid }
      },
    })
  }

  const subtitle = async (id: string | null): Promise<PlayerOutcome> => {
    subtitlePicks += 1
    return pick({
      wanted: { subtitle: id },
      choice: () => {
        const sid = id === null ? MPV_CHOICES.no : sidFor({ list: trackList(), id })
        return sid === null ? null : { name: MPV_PROPERTIES.sid, value: sid }
      },
    })
  }

  /**
   * The subtitle the load asked for may be a sidecar that came after the budget: once the late
   * sidecars are in, it is selected, unless the file changed or the page picked another
   * meanwhile, even one mpv has not answered yet.
   */
  const selectLateSubtitle = async ({ pending, token, id }: SelectLateSubtitleProps) => {
    const picks = subtitlePicks
    const isWanted = () =>
      token === epoch() && subtitlePicks === picks && (title()?.wanted.subtitle ?? null) === id
    const isStillCurrent = await pending
    if (!isStillCurrent || !isWanted()) return
    const list = await quiet.readOr({ name: MPV_PROPERTIES.trackList, fallback: [] })
    if (!isWanted()) return
    const sid = sidFor({ list, id })
    if (sid === null) return
    await quiet.set({ name: MPV_PROPERTIES.sid, value: sid })
  }

  return { aidOf, sidOf, audio, subtitle, selectLateSubtitle }
}
