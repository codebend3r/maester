type VersionLineProps = { version: string; platforms: string; date: string }

/** Every line of text the splash's scripts put on its pages. */
export const SPLASH_COPY = {
  versionLine: ({ version, platforms, date }: VersionLineProps) =>
    `Version ${version} for ${platforms}, released ${date}. `,
  everyVersion: 'Every version',
  whatsNew: "What's new on GitHub",
  versionsFailed:
    'GitHub did not answer with the list. Try again in a minute, or open the releases on GitHub.',
  downloadFor: (platform: string) => `Download for ${platform}`,
  platformsJoiner: ' and ',
} as const
