/**
 * 不可达文件 / 异步 Chunk 分析器
 *
 * - analyzeUnreachableFiles：对比「glob 扫到的源文件」与「module graph 可达集合」
 * - analyzeOrphanChunks：找出仅被 dynamic import 引用、未被静态引用的 chunk
 */
import path from 'node:path'
import type { AnalysisContext, ResourceIssue } from '../types'
import {
  estimateParseMs,
  fileSizeKb,
  normalizePath,
  toRelative,
  uniqueId,
} from '../utils/fs'
import { getReachableModules } from './import-pattern-analyzer'

/**
 * 检测静态不可达源文件
 * 逻辑：src 中存在，但不在 entry → module graph 可达集合中，且无 importers
 */
export function analyzeUnreachableFiles(ctx: AnalysisContext): ResourceIssue[] {
  if (!ctx.options.scanUnreachable) return []

  const issues: ResourceIssue[] = []
  const reachable = getReachableModules(ctx)
  let index = 0

  // 将 module graph 中的模块 id 统一转为绝对路径集合
  const reachableAbsPaths = new Set<string>()
  for (const moduleId of reachable) {
    // 跳过 Rollup 虚拟模块
    if (moduleId.startsWith('\0') || moduleId.includes('virtual:')) continue
    const abs = path.isAbsolute(moduleId)
      ? normalizePath(moduleId)
      : normalizePath(path.resolve(ctx.projectRoot, moduleId))
    reachableAbsPaths.add(abs)
  }

  for (const sourceFile of ctx.sourceFiles) {
    const normalized = normalizePath(sourceFile)

    // 构建入口本身不算不可达
    const isEntry = ctx.entries.some((e) => normalizePath(path.resolve(e)) === normalized)
    if (isEntry) continue

    // 路径模糊匹配：处理 Vite 解析前后路径差异
    const isReachable = [...reachableAbsPaths].some(
      (r) => r === normalized || normalized.endsWith(r) || r.endsWith(normalized),
    )

    // 双重保险：若 module graph 中有 importers 记录，也视为可达
    const mod = ctx.parsedModules.get(normalized) ?? ctx.parsedModules.get(sourceFile)
    const hasImporters = mod && mod.importers.size > 0

    if (isReachable || hasImporters) continue

    const sizeKb = fileSizeKb(sourceFile)
    const relativeFile = toRelative(ctx.projectRoot, sourceFile)

    // 页面/组件类文件不可达 → 严重级别更高（更可能是遗留代码）
    const isPageOrComponent =
      /pages?|views?|components?|routes?/i.test(relativeFile) &&
      /\.(vue|tsx|jsx)$/.test(relativeFile)

    issues.push({
      id: uniqueId('unreachable', index++),
      category: 'unreachable-component',
      severity: isPageOrComponent ? 'high' : 'medium',
      title: isPageOrComponent ? '不可达页面/组件' : '不可达源文件',
      file: relativeFile,
      detail: `${relativeFile} 未出现在任何构建入口的 module graph 中，属于静态不可达代码。`,
      suggestion: isPageOrComponent
        ? '若业务已下线，删除该页面/组件及关联静态资源。'
        : '确认是否仍被动态路径引用；若无，请删除或移出 src。',
      cost: {
        transferKb: sizeKb,
        parseMsEstimate: estimateParseMs(sizeKb),
        description: `文件本体 ${sizeKb} KB；若被 glob 扫入可能产生更大 chunk 浪费`,
      },
      metadata: {
        isPageOrComponent,
      },
    })
  }

  return issues
}

/**
 * 检测「独立异步 chunk」
 * 从 entry chunk 静态 BFS 无法到达的 chunk，通常仅由 dynamic import 加载
 * 本身不是浪费，但若被 prefetch 则会产生加载浪费
 */
export function analyzeOrphanChunks(ctx: AnalysisContext): ResourceIssue[] {
  const issues: ResourceIssue[] = []
  let index = 0

  const entryChunks = ctx.bundleFiles.filter((f) => f.isEntry)
  const allChunkNames = new Set(ctx.bundleFiles.filter((f) => f.type === 'chunk').map((f) => f.fileName))

  // 从 entry chunk 出发，沿静态 imports 边 BFS
  const reachableChunks = new Set<string>()
  const queue = entryChunks.map((c) => c.fileName)

  while (queue.length) {
    const name = queue.shift()!
    if (reachableChunks.has(name)) continue
    reachableChunks.add(name)

    const chunk = ctx.bundleFiles.find((f) => f.fileName === name)
    if (!chunk) continue

    for (const imp of chunk.imports ?? []) {
      if (allChunkNames.has(imp) && !reachableChunks.has(imp)) queue.push(imp)
    }
    // dynamicImports 不参与静态可达性（lazy chunk 设计上就是按需加载）
  }

  for (const chunk of ctx.bundleFiles) {
    if (chunk.type !== 'chunk' || chunk.isEntry) continue
    if (reachableChunks.has(chunk.fileName)) continue

    const sizeKb = Math.round((chunk.size / 1024) * 100) / 100
    // 启发式：文件名含 legacy/admin 的更可能被误 prefetch
    const isDynamicOnly = chunk.fileName.includes('legacy') || chunk.fileName.includes('admin')

    issues.push({
      id: uniqueId('orphan-chunk', index++),
      category: 'static-unused-js',
      severity: 'low',
      title: '独立异步 chunk（未被静态引用）',
      file: chunk.fileName,
      detail: `产物 chunk ${chunk.fileName} (${sizeKb} KB) 仅通过动态 import 加载，本身不是浪费，但若被全站 prefetch 则会产生加载浪费。`,
      suggestion: '检查是否对该 chunk 配置了不必要的 prefetch/preload。',
      cost: {
        transferKb: 0,
        parseMsEstimate: 0,
        description: '本身为按需加载；浪费取决于 prefetch 策略',
      },
      metadata: {
        chunkSizeKb: sizeKb,
        dynamicOnly: true,
        suspiciousPrefetch: isDynamicOnly,
      },
    })
  }

  return issues
}
