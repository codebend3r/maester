import { ENCODER_KINDS, HEALTH_STATUSES, METADATA_SERVICE_STATES } from '@raven/core'

/** An open `/api/health` answer, with `serverId` as a server names itself; one too old names none. */
export const healthOf = (serverId?: string) => ({
  status: HEALTH_STATUSES.ok,
  ffmpeg: '7.1',
  tonemap: true,
  encoder: ENCODER_KINDS.software,
  thumbnailsPending: 0,
  metadata: {
    tmdb: METADATA_SERVICE_STATES.off,
    omdb: METADATA_SERVICE_STATES.off,
    mdblist: METADATA_SERVICE_STATES.off,
    pending: 0,
    error: null,
    lastOk: null,
    ai: METADATA_SERVICE_STATES.off,
    aiRemaining: 0,
    aiPending: 0,
  },
  ...(serverId === undefined ? {} : { serverId }),
})
