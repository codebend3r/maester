export const CHAT_COPY = {
  broke: (ref: string) => `Something broke on sparrow's side (ref ${ref}).`,
  cutOff: 'The reply was cut off.',
  interrupted: 'The page was reloaded before this reply arrived.',
  unreachable: "Couldn't reach sparrow; check that its server or the sandbox is running.",
  notForgotten: "Couldn't start over: sparrow didn't answer, so the conversation stays.",
} as const
