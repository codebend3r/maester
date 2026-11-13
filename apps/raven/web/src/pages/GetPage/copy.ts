export const GET_COPY = {
  nav: 'Get raven',
  openWebApp: 'Open web app',
  headline: 'Your films and shows, from your own server.',
  pitch:
    'raven plays the library you already keep. Install it on your computer, or open it in any browser pointed at your server.',
  downloadFor: (name: string) => `Download for ${name}`,
  openInBrowser: 'Open in your browser',
  everySystem: 'macOS, Windows and Linux',
  needsSeparator: ' ·',
  otherPlatforms: 'Other platforms',
  chooseYours: 'Choose yours',
  about: 'raven · a self-hosted video library and player',
  source: 'Source on GitHub',
  releaseNotes: 'Release notes',
  previewFeature: 'Dune: Part Two',
  yourSystem: 'Your system',
  fileOf: (name: string) => `${name}, `,
  inTheBrowser: 'In the browser',
  nothingToInstall: 'Nothing to install',
  yourServer: 'Your server',
  downloadsTitle: 'Get raven',
  downloadsLead:
    'The desktop app and the web app are the same raven. Pick whichever suits the screen.',
} as const

/** What raven does, a column each. */
export const GET_FEATURES_COPY = [
  {
    icon: 'play',
    title: 'Plays what you have',
    text: 'The original file plays as it is when your device can take it. When it cannot, your server converts it on the way.',
  },
  {
    icon: 'history',
    title: 'Picks up where you stopped',
    text: 'Continue watching, next episodes and history follow you from the desktop app to the browser and back.',
  },
  {
    icon: 'libraries',
    title: 'Kept in order',
    text: 'Films are matched to TMDB, grouped into sagas, and sorted the way you left them. Locked libraries stay behind a PIN.',
  },
] as const
