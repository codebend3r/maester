/**
 * Node runs file reads, stats and directory listings on a pool of four
 * threads unless told otherwise. Over SMB each call waits on the network,
 * so four is soon full: one scan and a single video can queue behind each
 * other. Sixteen leaves room for scans (capped at four, see `scanner/walk`)
 * and several players at once.
 *
 * libuv sizes the pool the first time it is used, so `main.ts` calls this
 * before creating the app; loading modules touches no files. An explicit
 * UV_THREADPOOL_SIZE in the environment still wins.
 */
export const sizeThreadpool = (): void => {
  process.env.UV_THREADPOOL_SIZE ??= '16'
}
