/**
 * 未使用的静态 import 分析器
 *
 * 检测「已 import 但未引用」的本地模块（尤其 .vue 页面/组件），
 * 并与构建产物交叉验证：若仍被打包则提高严重级别。
 *
 * 仅在「有效引用链」上的文件内扫描：从构建入口沿已使用的 import 边 BFS，
 * 未挂路由/未被引用的页面子树（如 HomeView → TheWelcome → icons）不再重复报 issue。
 */
import fs from 'node:fs'
import path from 'node:path'
import type { AnalysisContext, IssueSeverity, ResourceIssue } from '../types'
import {
  estimateParseMs,
  fileSizeKb,
  normalizePath,
  readTextSafe,
  toRelative,
  uniqueId,
} from '../utils/fs'

interface ImportBinding {
  localName: string
  specifier: string
}

/** 收集构建产物 chunk 中包含的模块 id */
function getBundledModuleIds(ctx: AnalysisContext): Set<string> {
  const ids = new Set<string>()
  for (const file of ctx.bundleFiles) {
    if (file.type !== 'chunk' || !file.modules) continue
    for (const moduleId of file.modules) {
      ids.add(normalizePath(moduleId))
    }
  }
  return ids
}

function moduleInBundle(resolvedPath: string, bundledIds: Set<string>): boolean {
  if (bundledIds.size === 0) return false
  const normalized = normalizePath(resolvedPath)
  for (const id of bundledIds) {
    if (id === normalized || id.endsWith(normalized) || normalized.endsWith(id)) return true
  }
  return false
}

/** 解析相对路径 import 为绝对路径（尝试常见后缀与 index 文件） */
function resolveLocalImport(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null

  const base = path.resolve(path.dirname(fromFile), specifier)
  if (path.extname(base)) {
    return fs.existsSync(base) ? normalizePath(base) : null
  }

  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.vue', '.svelte', '.mjs', '.cjs']
  for (const ext of extensions) {
    const candidate = base + ext
    if (fs.existsSync(candidate)) return normalizePath(candidate)
  }

  for (const ext of extensions) {
    const candidate = path.join(base, 'index' + ext)
    if (fs.existsSync(candidate)) return normalizePath(candidate)
  }

  return null
}

function pascalToKebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

/** 从 Vue SFC 提取 script 与用于 usage 检测的模板内容（含嵌套 slot template） */
function extractVueSections(content: string): { script: string; template: string } {
  const script =
    content.match(/<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/i)?.[1] ?? ''
  const withoutScript = content.replace(/<script[\s\S]*?<\/script>/gi, '')
  const withoutStyle = withoutScript.replace(/<style[\s\S]*?<\/style>/gi, '')
  // 保留所有 template 块内部内容（含 #icon 等具名 slot），避免只匹配到第一个嵌套 template
  const template = withoutStyle.replace(/<\/?template[^>]*>/gi, '')
  return { script, template }
}

/** 移除 import 语句，避免 import 行内的标识符被误判为「已使用」 */
function stripImportStatements(code: string): string {
  let result = code.replace(/^\s*import\s+['"][^'"]+['"]\s*;?\s*$/gm, '')
  result = result.replace(/import\s+(?:type\s+)?(?:(?!\n\s*import)[\s\S])*?\s+from\s+['"][^'"]+['"]\s*;?/g, '')
  return result
}

function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
}

/** 解析 import 子句中的本地绑定名（仅合法标识符） */
function parseImportClause(clause: string): string[] {
  const trimmed = clause.trim()
  if (!trimmed || trimmed.startsWith('type ') || /\bimport\s/.test(trimmed)) return []

  const bindings: string[] = []

  const nsMatch = trimmed.match(/^\*\s+as\s+(\w+)(?:\s*,\s*(.+))?$/)
  if (nsMatch) {
    bindings.push(nsMatch[1]!)
    if (nsMatch[2]) bindings.push(...parseNamedImports(nsMatch[2]))
    return bindings.filter(isValidBindingName)
  }

  const braceIdx = trimmed.indexOf('{')
  if (braceIdx === -1) {
    const defaultName = trimmed.replace(/,$/, '').trim()
    if (isValidBindingName(defaultName)) bindings.push(defaultName)
    return bindings
  }

  const defaultPart = trimmed.slice(0, braceIdx).replace(/,$/, '').trim()
  if (isValidBindingName(defaultPart)) bindings.push(defaultPart)
  bindings.push(...parseNamedImports(trimmed.slice(braceIdx)))
  return bindings.filter(isValidBindingName)
}

function isValidBindingName(name: string): boolean {
  return /^\w+$/.test(name)
}

/** 将 script 拆成独立的 import 语句（避免 side-effect import 与 from-import 被正则跨行合并） */
function splitImportStatements(script: string): string[] {
  const statements: string[] = []
  const lines = script.split('\n')
  let current = ''
  let inImport = false

  const finishImport = () => {
    if (current.trim()) statements.push(current.trim())
    current = ''
    inImport = false
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (!inImport && trimmed.startsWith('import ')) {
      inImport = true
      current = line
    } else if (inImport) {
      current += `\n${line}`
    }

    if (!inImport) continue

    // 副作用 import：import 'module'（无 from、无绑定）
    if (/^import\s+['"][^'"]+['"]\s*;?\s*$/.test(current.trim())) {
      finishImport()
      continue
    }

    // 含 from 的 import 语句结束
    if (/from\s+['"][^'"]+['"]\s*;?\s*$/.test(trimmed)) {
      finishImport()
    }
  }

  if (inImport && current.trim()) statements.push(current.trim())
  return statements
}

/** 是否为副作用 import（无绑定，仅执行模块副作用） */
function isSideEffectImport(stmt: string): boolean {
  return /^import\s+['"][^'"]+['"]\s*;?\s*$/.test(stmt.trim())
}

function parseNamedImports(block: string): string[] {
  const bindings: string[] = []
  const inner = block.match(/\{([\s\S]*)\}/)?.[1] ?? block
  for (const part of inner.split(',')) {
    const item = part.trim()
    if (!item || item.startsWith('type ')) continue
    const asMatch = item.match(/(?:\w+\s+as\s+)?(\w+)\s*$/)
    if (asMatch) bindings.push(asMatch[1]!)
  }
  return bindings
}

/** 从 script 源码中提取静态 import 绑定（跳过 type-only 与副作用 import） */
function extractStaticImports(script: string): ImportBinding[] {
  const bindings: ImportBinding[] = []

  for (const stmt of splitImportStatements(script)) {
    if (isSideEffectImport(stmt)) continue
    if (/^\s*import\s+type\s+/.test(stmt)) continue

    const fromMatch = stmt.match(/^\s*import\s+(?:type\s+)?([\s\S]+?)\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/)
    if (!fromMatch) continue

    const clause = fromMatch[1]!.trim()
    const specifier = fromMatch[2]!
    if (!clause || clause.startsWith('type ') || /\bimport\s/.test(clause)) continue

    for (const localName of parseImportClause(clause)) {
      bindings.push({ localName, specifier })
    }
  }

  return bindings
}

function isBindingUsed(binding: string, searchSpace: string, template: string): boolean {
  const code = stripComments(searchSpace)
  const bindingRe = new RegExp(`\\b${binding}\\b`)
  if (bindingRe.test(code)) return true

  if (!template) return false

  const templateBody = stripComments(template)
  if (bindingRe.test(templateBody)) return true

  const kebab = pascalToKebab(binding)
  if (kebab !== binding.toLowerCase()) {
    const kebabRe = new RegExp(`<${kebab}[\\s/>]`, 'i')
    if (kebabRe.test(templateBody)) return true
  }

  return false
}

interface UnusedImportCandidate {
  localName: string
  specifier: string
  resolved: string | null
}

/** 构建「有效引用」边：仅当 import 绑定在文件内被使用时，才建立 importer → imported 关系 */
function buildUsedImportGraph(ctx: AnalysisContext): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>()

  for (const file of ctx.sourceFiles) {
    const content = readTextSafe(file)
    if (!content) continue

    const normalizedFile = normalizePath(file)
    const isVue = file.endsWith('.vue')
    const { script, template } = isVue ? extractVueSections(content) : { script: content, template: '' }
    const searchSpace = stripImportStatements(isVue ? script : content)

    for (const { localName, specifier } of extractStaticImports(script)) {
      if (!specifier.startsWith('.')) continue
      if (!isBindingUsed(localName, searchSpace, template)) continue

      const resolved = resolveLocalImport(file, specifier)
      if (!resolved) continue

      const deps = graph.get(normalizedFile) ?? new Set<string>()
      deps.add(normalizePath(resolved))
      graph.set(normalizedFile, deps)
    }
  }

  return graph
}

/**
 * 从构建入口出发，沿「有效 import 边」BFS，得到仍在活跃引用链上的源文件。
 * 未被引用的页面/组件子树（如未挂路由的 HomeView）不在此集合中，不再对其做 dead-import 扫描。
 */
function getLiveSourceFiles(ctx: AnalysisContext, usedGraph: Map<string, Set<string>>): Set<string> {
  const sourceSet = new Set(ctx.sourceFiles.map((f) => normalizePath(f)))
  const live = new Set<string>()
  const queue: string[] = []

  const enqueue = (p: string) => {
    const n = normalizePath(p)
    if (sourceSet.has(n) && !live.has(n)) queue.push(n)
  }

  for (const entry of ctx.entries) {
    enqueue(entry)
    const mod = ctx.parsedModules.get(normalizePath(entry))
    if (mod) {
      for (const dep of mod.importedIds) enqueue(dep)
    }
  }

  for (const file of ctx.sourceFiles) {
    const n = normalizePath(file)
    if (ctx.parsedModules.get(n)?.isEntry) enqueue(n)
  }

  // 无法解析入口时（如 dev 轻量模式），回退为扫描全部源文件
  if (queue.length === 0) {
    return sourceSet
  }

  while (queue.length) {
    const current = queue.shift()!
    if (live.has(current)) continue
    live.add(current)

    for (const dep of usedGraph.get(current) ?? []) {
      if (!live.has(dep)) queue.push(dep)
    }
  }

  return live
}

function collectUnusedImportsForFile(
  file: string,
  content: string,
): UnusedImportCandidate[] {
  const isVue = file.endsWith('.vue')
  const { script, template } = isVue ? extractVueSections(content) : { script: content, template: '' }
  const searchSpace = stripImportStatements(isVue ? script : content)
  const unused: UnusedImportCandidate[] = []

  for (const { localName, specifier } of extractStaticImports(script)) {
    if (!specifier.startsWith('.')) continue
    if (isBindingUsed(localName, searchSpace, template)) continue
    unused.push({
      localName,
      specifier,
      resolved: resolveLocalImport(file, specifier),
    })
  }

  return unused
}

function isPageOrComponentPath(relativePath: string): boolean {
  return (
    /\.(vue|tsx|jsx)$/i.test(relativePath) &&
    /pages?|views?|components?|routes?/i.test(relativePath)
  )
}

function resolveSeverity(
  importedRelative: string,
  inBundle: boolean,
  hasBundle: boolean,
): IssueSeverity {
  const isComponent = isPageOrComponentPath(importedRelative)
  if (inBundle) return isComponent ? 'medium' : 'medium'
  if (hasBundle) return 'low'
  return isComponent ? 'medium' : 'low'
}

/**
 * 扫描源码中未使用的本地静态 import
 */
export function analyzeUnusedImports(ctx: AnalysisContext): ResourceIssue[] {
  if (!ctx.options.scanUnusedImports) return []

  const issues: ResourceIssue[] = []
  const bundledIds = getBundledModuleIds(ctx)
  const hasBundle = bundledIds.size > 0
  const usedGraph = buildUsedImportGraph(ctx)
  const liveFiles = getLiveSourceFiles(ctx, usedGraph)
  let index = 0

  for (const file of ctx.sourceFiles) {
    const normalizedFile = normalizePath(file)
    if (!liveFiles.has(normalizedFile)) continue

    const content = readTextSafe(file)
    if (!content) continue

    const relativeFile = toRelative(ctx.projectRoot, file)
    const unusedImports = collectUnusedImportsForFile(file, content)
    if (unusedImports.length === 0) continue

    for (const { localName, specifier, resolved } of unusedImports) {
      const importedRelative = resolved
        ? toRelative(ctx.projectRoot, resolved)
        : specifier

      const inBundle = resolved ? moduleInBundle(resolved, bundledIds) : false
      const severity = resolveSeverity(importedRelative, inBundle, hasBundle)
      const importedSizeKb = resolved ? fileSizeKb(resolved) : 0

      const detail = inBundle
        ? `${relativeFile} 引入了 \`${importedRelative}\`（绑定 \`${localName}\`）但未在文件内使用。该模块仍出现在构建产物中（约 ${importedSizeKb} KB）。`
        : `${relativeFile} 引入了 \`${importedRelative}\`（绑定 \`${localName}\`）但未在文件内使用。`

      issues.push({
        id: uniqueId('dead-import', index++),
        category: 'dead-import',
        severity,
        title: `未使用的静态 import: ${localName}`,
        file: relativeFile,
        detail,
        suggestion: isPageOrComponentPath(importedRelative)
          ? `删除冗余 import；若路由/页面已下线，确认 \`${importedRelative}\` 是否也可移除。`
          : `删除未使用的 import \`${localName}\` from '${specifier}'。`,
        cost: {
          transferKb: inBundle ? importedSizeKb : 0,
          parseMsEstimate: inBundle ? estimateParseMs(importedSizeKb) : 0,
          description: inBundle
            ? `冗余 import 导致约 ${importedSizeKb} KB 进入产物`
            : '维护性浪费',
        },
        metadata: {
          binding: localName,
          specifier,
          importedModule: importedRelative,
          inBundle,
        },
      })
    }
  }

  return issues
}
