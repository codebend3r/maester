type AcceptLabelProps = { name: string; subject: string }

export const AI_SUGGESTION_CARD_COPY = {
  suggested: (name: string) => `Suggested: ${name}`,
  fixMatchFor: (subject: string) => `Fix match for ${subject}`,
  accept: 'Accept',
  acceptFor: ({ name, subject }: AcceptLabelProps) => `Accept ${name} for ${subject}`,
} as const
