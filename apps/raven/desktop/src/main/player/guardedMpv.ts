import { MPV_COMMANDS, type Mpv } from '@raven/mpv'

export type MpvControl = Pick<Mpv, 'command' | 'set' | 'read' | 'observe'>

/**
 * Options a server title carries on its own `loadfile`, never set globally: mpv reads
 * them as it opens a stream, not when a command is sent, so a global value set for the
 * next title could ride on the request of the one before. Per-file values also end with
 * their file, and a global set would override them.
 */
export const PER_FILE_OPTIONS = ['http-header-fields', 'stream-lavf-o', 'network-timeout'] as const

/**
 * Any way of naming a per-file option outside `loadfile`: itself, its list suffixes
 * (`-append`, `-set`, ...) and its `file-local-options/` or `options/` paths.
 */
const namesPerFileOption = (name: string): boolean =>
  PER_FILE_OPTIONS.some((option) => name.includes(option))

/**
 * mpv as the service reaches it: a per-file option set, changed or cycled by any route
 * but the `loadfile` options fails before mpv hears of it.
 */
export const guardedMpv = (mpv: MpvControl): MpvControl => ({
  ...mpv,
  set: async (option) => {
    if (namesPerFileOption(option.name)) {
      throw new Error(`${option.name} is set per file, never globally`)
    }
    await mpv.set(option)
  },
  command: async (input) => {
    const [name = ''] = input.args
    const named = name === MPV_COMMANDS.loadfile ? undefined : input.args.find(namesPerFileOption)
    if (named !== undefined) throw new Error(`${named} is set per file, never globally`)
    await mpv.command(input)
  },
})
