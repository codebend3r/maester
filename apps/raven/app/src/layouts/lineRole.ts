/** What a line of words is to a screen reader: an alert it says at once, or plain text. */
const LINE_ROLES = { alert: 'alert', text: 'text' } as const

type LineRole = (typeof LINE_ROLES)[keyof typeof LINE_ROLES]

/** A line's role: an alert for something gone wrong, read out the moment it shows, else text. */
export const lineRoleOf = (isAlert: boolean): LineRole =>
  isAlert ? LINE_ROLES.alert : LINE_ROLES.text
