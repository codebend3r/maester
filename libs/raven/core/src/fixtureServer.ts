/**
 * What `@raven/server`'s `serve:fixture` holds and how it is started, shared by the server that
 * builds it and the Playwright end to end suites that read it, raven's web app's, Wren on the
 * web's and Wren for Mac's. `serve:lighthouse` is the larger library the web's Lighthouse run scores Home against,
 * on a port of its own. The device app's and Wren's Maestro flows name the same titles in YAML,
 * which can import nothing.
 */
export const FIXTURE_SERVER = {
  /** The device apps' fixture listens here, the port their builds name. */
  appPort: 8490,
  /** raven's web suite's listens here, so it never meets a device fixture left running. */
  webPort: 8491,
  /** Wren on the web's suite listens here, so it runs beside raven's web suite. */
  wrenWebPort: 8493,
  /** Wren for Mac's suite listens here, so it runs beside the browser suites. */
  wrenDesktopPort: 8494,
  /** The Lighthouse fixture's, which the web's Lighthouse server starts and sends `/api` to. */
  lighthousePort: 8492,
  host: '127.0.0.1',
  /** What a runner polls until the fixture answers: it listens only once its scans are done. */
  readyPath: '/api/health',
  env: {
    /** The built web app's folder, which the fixture then serves beside its API. */
    webDir: 'RAVEN_FIXTURE_WEB_DIR',
    port: 'RAVEN_FIXTURE_PORT',
  },
  movie: { library: 'Films', title: 'Kestrel Point' },
  show: {
    library: 'Series',
    title: 'Lantern Bay',
    episodes: ['Low Tide', 'High Water'],
    /** What the second episode's two sidecars say, each for nearly all of the clip. */
    cues: { english: 'The water is rising.', spanish: 'El agua está subiendo.' },
    /** The second episode's intro, in seconds, which a chapter of its file names. */
    intro: { start: 5, end: 25 },
  },
  album: {
    library: 'Music',
    title: 'Morning Chorus',
    artist: 'The Fixture Birds',
    tracks: ['First Light', 'Dawn Song', 'Open Sky'],
  },
  /**
   * Coming soon's titles, from the fixture's fake TMDB, and what its fake Radarr and Sonarr hold:
   * `held` is in Radarr already, so it is never requested; `open` and `show` are free to request.
   */
  upcoming: {
    held: { tmdbId: '9101', title: 'Harbour Lights' },
    open: { tmdbId: '9102', title: 'Quiet Meridian' },
    show: { tmdbId: '9103', title: 'The Long Thaw' },
  },
} as const
