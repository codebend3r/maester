import { parseArgs } from 'node:util'

// Bun's own coverageThreshold holds every file to the floor on its own, so one
// component with an untested callback fails the run, and the run still ends
// "0 fail" with nothing saying why. This holds the total in Bun's lcov report
// to the floor instead. Bun leaves a file no test imports out of the report
// entirely, so such a file neither raises nor lowers the total.

type Counter = 'LF' | 'LH' | 'FNF' | 'FNH'

const METRICS = [
  { name: 'lines', hit: 'LH', found: 'LF' },
  { name: 'functions', hit: 'FNH', found: 'FNF' },
] as const satisfies ReadonlyArray<{ name: string; hit: Counter; found: Counter }>

const readFloor = ({ name, value }: { name: string; value: string | undefined }): number => {
  const floor = Number(value)
  if (!/^\d+(\.\d+)?$/.test(value ?? '') || floor > 100) {
    throw new Error(`--${name} needs a percentage from 0 to 100, got ${value ?? 'nothing'}`)
  }
  return floor
}

const { values } = parseArgs({
  options: {
    lcov: { type: 'string', default: 'coverage/lcov.info' },
    lines: { type: 'string' },
    functions: { type: 'string' },
  },
})

const report = Bun.file(values.lcov)
if (!(await report.exists())) {
  throw new Error(
    `No lcov report at ${values.lcov}; run bun test with --coverage --coverage-reporter=lcov`,
  )
}

const records = (await report.text()).split('\n').map((line) => line.split(':'))

const total = (counter: Counter): number =>
  records.reduce((sum, [key, count]) => (key === counter ? sum + Number(count) : sum), 0)

const results = METRICS.map(({ name, hit, found }) => {
  const covered = total(hit)
  const coverable = total(found)
  return {
    name,
    covered,
    coverable,
    floor: readFloor({ name, value: values[name] }),
    percent: coverable === 0 ? 100 : (100 * covered) / coverable,
  }
})

process.stdout.write(
  results
    .map(
      ({ name, covered, coverable, floor, percent }) =>
        `coverage: ${name} ${percent.toFixed(2)}% (${covered}/${coverable}), floor ${floor}%\n`,
    )
    .join(''),
)

const failing = results.filter(({ percent, floor }) => percent < floor)
if (failing.length > 0) {
  console.error(
    `Coverage fell below the floor for ${failing.map(({ name }) => name).join(' and ')}. ` +
      'Run bun test --coverage for the per-file table.',
  )
  process.exitCode = 1
}
