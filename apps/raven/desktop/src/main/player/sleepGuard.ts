export const createSleepGuard = ({
  start,
  stop,
}: {
  start: () => number
  stop: (id: number) => void
}) => {
  let held: number | null = null

  return {
    set: (isPlaying: boolean) => {
      if (isPlaying) {
        held ??= start()
        return
      }
      if (held === null) return
      const id = held
      held = null
      stop(id)
    },
  }
}
