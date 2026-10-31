import { dirname, relative, resolve } from 'node:path'
import { compile } from 'sass'
import ts from 'typescript'

// Every class a `*.module.scss` defines is read by the component that imports
// it, and every class a component reads exists in the module, so a dead
// selector or a misspelt class name fails the check. Runs as the root
// project's `dead-css` target over every project with a gale.json, so in
// `verify`, `affected` and the PR checks. A computed key (`styles[tone]`) is
// checked through its type, which has to be a union of string literals: the
// shape CLAUDE.md's constants rule produces.

type Use = { className: string; file: string; line: number }
type Problem = { file: string; line?: number; message: string }

const root = process.cwd()

const describe = ({ file, line }: Pick<Problem, 'file' | 'line'>): string =>
  line === undefined ? relative(root, file) : `${relative(root, file)}:${line}`

const loadProgram = (configPath: string): ts.Program => {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    configPath,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
      },
    },
  )
  if (!parsed) {
    throw new Error(`Could not read ${configPath}`)
  }
  return ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options })
}

type ResolveStylesheetProps = {
  specifier: string
  from: string
  options: ts.CompilerOptions
  configDir: string
}

// Resolves a stylesheet import the way the project's `paths` do, from the
// folder of the tsconfig that declares them.
const resolveStylesheet = ({
  specifier,
  from,
  options,
  configDir,
}: ResolveStylesheetProps): string | undefined => {
  if (specifier.startsWith('.')) {
    return resolve(dirname(from), specifier)
  }
  const mapped = Object.entries(options.paths ?? {}).flatMap(([pattern, targets]) => {
    const prefix = pattern.replace(/\*$/, '')
    const [target] = targets
    if (!pattern.endsWith('*') || !specifier.startsWith(prefix) || target === undefined) {
      return []
    }
    return [resolve(configDir, target.replaceAll('*', specifier.slice(prefix.length)))]
  })
  return mapped[0]
}

const stringLiteralsOf = (type: ts.Type): string[] | undefined => {
  const members = type.isUnion() ? type.types : [type]
  const literals = members.flatMap((member) => (member.isStringLiteral() ? [member.value] : []))
  return literals.length === members.length ? literals : undefined
}

const classNamesOf = (css: string): string[] => {
  const bare = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '')
    .replace(/\[[^\]]*\]/g, '')
  // Text before a `{` that holds no `{`, `}` or `;` is a selector list or an
  // at-rule prelude; declarations end with `;`, so none of them qualify.
  return [...bare.matchAll(/([^{};]+)\{/g)].flatMap(([, prelude]) => {
    if (prelude === undefined || prelude.trim().startsWith('@')) {
      return []
    }
    return [...prelude.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].flatMap(([, name]) =>
      name === undefined ? [] : [name],
    )
  })
}

const childrenOf = (node: ts.Node): ts.Node[] => {
  const children: ts.Node[] = []
  node.forEachChild((child) => {
    children.push(child)
  })
  return children
}

type UsesInProps = {
  node: ts.Node
  file: ts.SourceFile
  symbol: ts.Symbol
  checker: ts.TypeChecker
}

// Every `styles.x` and `styles[key]` whose `styles` is the given import.
const usesIn = ({
  node,
  file,
  symbol,
  checker,
}: UsesInProps): { uses: Use[]; problems: Problem[] } => {
  const nested = childrenOf(node).map((child) => usesIn({ node: child, file, symbol, checker }))
  const uses = nested.flatMap((result) => result.uses)
  const problems = nested.flatMap((result) => result.problems)
  const at = (target: ts.Node) => ({
    file: file.fileName,
    line: file.getLineAndCharacterOfPosition(target.getStart(file)).line + 1,
  })
  const isTheImport = (expression: ts.Expression) =>
    ts.isIdentifier(expression) && checker.getSymbolAtLocation(expression) === symbol

  if (ts.isPropertyAccessExpression(node) && isTheImport(node.expression)) {
    return { uses: [...uses, { className: node.name.text, ...at(node) }], problems }
  }
  if (!ts.isElementAccessExpression(node) || !isTheImport(node.expression)) {
    return { uses, problems }
  }
  const key = node.argumentExpression
  if (ts.isStringLiteralLike(key)) {
    return { uses: [...uses, { className: key.text, ...at(node) }], problems }
  }
  const position = at(node)
  const literals = stringLiteralsOf(checker.getTypeAtLocation(key))
  if (literals === undefined) {
    const message = `the key of styles[${key.getText(file)}] is typed ${checker.typeToString(checker.getTypeAtLocation(key))}, not a union of string literals, so its classes cannot be checked`
    return { uses, problems: [...problems, { ...at(node), message }] }
  }
  return {
    uses: [
      ...uses,
      ...literals.map((className) => ({ className, file: position.file, line: position.line })),
    ],
    problems,
  }
}

const checkProject = (project: string) => {
  const configPath = resolve(project, 'tsconfig.json')
  const program = loadProgram(configPath)
  const checker = program.getTypeChecker()
  const options = program.getCompilerOptions()
  const configDir = dirname(configPath)

  const sources = program
    .getSourceFiles()
    .filter(
      (file) =>
        !file.isDeclarationFile &&
        file.fileName.startsWith(`${project}/`) &&
        !file.fileName.includes('/node_modules/'),
    )

  const imports = sources.flatMap((file) =>
    file.statements.filter(ts.isImportDeclaration).flatMap((declaration) => {
      const specifier = ts.isStringLiteral(declaration.moduleSpecifier)
        ? declaration.moduleSpecifier.text
        : undefined
      const local = declaration.importClause?.name ?? null
      if (specifier === undefined || !specifier.endsWith('.module.scss') || local === null) {
        return []
      }
      const stylesheet = resolveStylesheet({ specifier, from: file.fileName, options, configDir })
      const symbol = checker.getSymbolAtLocation(local)
      if (stylesheet === undefined || symbol === undefined) {
        return []
      }
      return [{ file, stylesheet, symbol }]
    }),
  )

  const read = imports.map(({ file, stylesheet, symbol }) => {
    const found = usesIn({ node: file, file, symbol, checker })
    return { stylesheet, uses: found.uses, problems: found.problems }
  })
  const keyProblems = read.flatMap((result) => result.problems)

  const modules = [...new Bun.Glob('**/*.module.scss').scanSync({ cwd: project, absolute: true })]
    .filter((path) => !path.includes('/node_modules/') && !path.includes('/dist/'))
    .toSorted()

  const compiled = modules.map((stylesheet) => ({
    stylesheet,
    defined: new Set(classNamesOf(compile(stylesheet).css)),
  }))

  const moduleProblems = compiled.flatMap(({ stylesheet, defined }): Problem[] => {
    const importers = read.filter((result) => result.stylesheet === stylesheet)
    if (importers.length === 0) {
      return [{ file: stylesheet, message: 'no component imports this module' }]
    }
    const uses = importers.flatMap((result) => result.uses)
    const used = new Set(uses.map((use) => use.className))
    const dead = [...defined]
      .filter((className) => !used.has(className))
      .map((className) => ({
        file: stylesheet,
        message: `.${className} is defined but no component reads styles.${className}`,
      }))
    const missing = uses
      .filter((use) => !defined.has(use.className))
      .map((use) => ({
        file: use.file,
        line: use.line,
        message: `styles.${use.className} is read but ${relative(root, stylesheet)} defines no .${use.className}`,
      }))
    return [...dead, ...missing]
  })

  return {
    problems: [...keyProblems, ...moduleProblems],
    modules: compiled.length,
    classes: compiled.reduce((sum, { defined }) => sum + defined.size, 0),
  }
}

const projects = [
  ...new Bun.Glob('{apps,libs}/*/*/gale.json').scanSync({ cwd: root, absolute: true }),
]
  .map(dirname)
  .toSorted()

const results = projects.map(checkProject)
const problems = results.flatMap((result) => result.problems)
const counted = results.reduce(
  (sum, { modules, classes }) => ({
    modules: sum.modules + modules,
    classes: sum.classes + classes,
  }),
  { modules: 0, classes: 0 },
)

process.stdout.write(
  `dead-css: checked ${counted.classes} classes in ${counted.modules} modules across ${projects.length} styled projects\n`,
)
if (problems.length > 0) {
  console.error(problems.map((problem) => `${describe(problem)}: ${problem.message}`).join('\n'))
  console.error(
    `\n${problems.length} dead or misspelt module classes. Delete the selector or fix the name.`,
  )
  process.exitCode = 1
}
