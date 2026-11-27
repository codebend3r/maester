import { execFile } from 'node:child_process'
import { E2E_SYSTEM } from '@/e2e/platform'

const ERROR_CODES = { eperm: 'EPERM' } as const

type PidProps = { pid: number }

/** The pids the system lists as children of `pid`; none when the listing fails or is empty. */
const childrenOf = ({ pid }: PidProps) =>
  new Promise<number[]>((resolve) => {
    const { command, args } = E2E_SYSTEM.listChildren({ pid })
    execFile(command, args, (_error, stdout) =>
      resolve(
        stdout
          .split('\n')
          .filter((line) => line.trim() !== '')
          .map(Number)
          .filter((child) => Number.isInteger(child)),
      ),
    )
  })

/** The app's process and every process under it (Electron's helpers), by pid. */
export const processTree = async ({ pid }: PidProps): Promise<number[]> => {
  const children = await childrenOf({ pid })
  const below = await Promise.all(children.map((child) => processTree({ pid: child })))
  return [pid, ...below.flat()]
}

// Signal 0 only asks whether the process exists; EPERM means it does, under another user.
export const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === ERROR_CODES.eperm
  }
}
