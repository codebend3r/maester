/**
 * An answer the test hands back by hand, for what a page shows while the
 * server has not answered yet: `answer` settles it, `refuse` fails it.
 */
export const held = <T>() => {
  const hands: { answer: (value: T) => void; refuse: (error: Error) => void } = {
    answer: () => undefined,
    refuse: () => undefined,
  }
  const promise = new Promise<T>((resolve, reject) => {
    hands.answer = resolve
    hands.refuse = reject
  })
  return { promise, answer: hands.answer, refuse: hands.refuse }
}
