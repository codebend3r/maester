export const MANAGERS_ONLY_COPY = {
  forTheAdmin: (name: string) => `${name} are for the admin`,
  forTheOwner: (name: string) => `${name} are for the owner`,
  turnOffBefore: 'Turn the admin lock off in ',
  turnOffAfter: (forAdmin: string) => ` to ${forAdmin}.`,
  onlyTheOwner: (forOwner: string) => `Only the owner can ${forOwner}.`,
} as const
