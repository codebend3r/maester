/**
 * Lets an action a click started run on its own, logging a failure it did not already say,
 * so no promise is left floating.
 */
export const handled = (action: Promise<unknown>): void => {
  action.catch((error: unknown) => console.error('raven player could not finish that.', error))
}
