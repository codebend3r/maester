/** The events of an `EventSource` that raven listens for. Apart from the hook, so the test preload imports nothing of the app. */
export const EVENT_SOURCE_EVENTS = { message: 'message', error: 'error', open: 'open' } as const
