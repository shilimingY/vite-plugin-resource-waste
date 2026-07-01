/**
 * Import 模式分析器
 *
 * 检测内容：
 * 1. 已知全量导入模式（lodash、moment、antd 等）
 * 2. barrel 文件（export * from）导致的 tree-shake 风险
 * 3. 疑似空组件文件
 *
 * 同时提供 collectSourceFiles / getReachableModules 供其他 analyzer 使用
 */
import path from 'node:path'
import { IMPORT_PATTERN_RULES, IMPORT_SUGGESTIONS, SOURCE_EXTENSIONS } from '../constants'
import type { AnalysisContext, ResourceIssue } from '../types'
import {
  estimateParseMs,
  readTextSafe,
  toRelative,
  uniqueId,
} from '../utils/fs'
import { collectFilesRecursive } from '../utils/glob'

/** 扫描源码中的低效 import 模式与 barrel 文件等问题 */
export async function analyzeImportPatterns(ctx: AnalysisContext): Promise<ResourceIssue[]> {
  if (!ctx.options.scanImportPatterns) return []

  const issues: ResourceIssue[] = []
  let index = 0

  for (const file of ctx.sourceFiles) {
    const content = readTextSafe(file)
    if (!content) continue

    const relativeFile = toRelative(ctx.projectRoot, file)

    for (const [pattern, pkg, severity, wasteKb] of IMPORT_PATTERN_RULES) {
      if (!pattern.test(content)) continue

      const gzipEstimate = Math.round(wasteKb * 0.35)
      issues.push({
        id: uniqueId('import-pattern', index++),
        category: 'import-pattern',
        severity,
        title: `全量/低效导入: ${pkg}`,
        file: relativeFile,
        detail: `${relativeFile} 存在可能导致 tree-shake 失效的导入（${pkg}）。`,
        suggestion: IMPORT_SUGGESTIONS[pkg] ?? '改为按需导入',
        cost: {
          transferKb: gzipEstimate,
          parseMsEstimate: estimateParseMs(gzipEstimate),
          description: `预估 gzip 后约 ${gzipEstimate} KB`,
        },
        metadata: { packageName: pkg },
      })
    }

    // 辅助信号：检测 export 形态，识别 barrel 文件等
    const hasDefaultExport = /export\s+default/.test(content)
    const hasNamedExport = /export\s+(const|function|class|type|interface|\{)/.test(content)
    const isIndexBarrel = /export\s+\*\s+from/.test(content)

    if (isIndexBarrel) {
      issues.push({
        id: uniqueId('import-pattern', index++),
        category: 'import-pattern',
        severity: 'medium',
        title: 'Barrel 文件可能导致 tree-shake 失效',
        file: relativeFile,
        detail: `${relativeFile} 使用了 export * from 模式，容易导致未使用的模块被一并打包。`,
        suggestion: '改为显式具名导出，或直接从源文件按需导入。',
        cost: {
          transferKb: 15,
          parseMsEstimate: estimateParseMs(15),
          description: 'Barrel 文件间接引入的冗余体积难以精确量化，此为保守估计',
        },
      })
    }

    // 疑似空组件：在 components 目录下且内容极少
    if (!hasDefaultExport && !hasNamedExport && relativeFile.includes('/components/')) {
      if (content.trim().length < 20) {
        issues.push({
          id: uniqueId('static-unused', index++),
          category: 'static-unused-js',
          severity: 'low',
          title: '疑似空组件文件',
          file: relativeFile,
          detail: `${relativeFile} 几乎没有有效内容，可能是遗留文件。`,
          suggestion: '确认是否仍需要，不需要则删除。',
          cost: {
            transferKb: 0,
            parseMsEstimate: 0,
            description: '维护成本浪费',
          },
        })
      }
    }
  }

  return issues
}

/**
 * 收集 src 下源码文件（Node 原生递归遍历，无 fast-glob 依赖）
 */
export async function collectSourceFiles(ctx: AnalysisContext): Promise<string[]> {
  const rootDir = path.resolve(ctx.projectRoot, ctx.options.root ?? 'src')
  const extensions = [
    ...SOURCE_EXTENSIONS,
    ...((ctx.options.include ?? [])
      .map((p) => path.extname(p))
      .filter(Boolean)),
  ]

  return collectFilesRecursive(rootDir, extensions, ctx.options.exclude ?? [])
}

/**
 * 从构建入口出发 BFS 遍历 module graph，得到所有静态可达模块
 * 用于判断源文件是否「不可达」
 */
export function getReachableModules(ctx: AnalysisContext): Set<string> {
  const reachable = new Set<string>()
  const queue = [...ctx.entries]

  while (queue.length) {
    const current = queue.shift()!
    if (reachable.has(current)) continue
    reachable.add(current)

    const mod = ctx.parsedModules.get(current)
    if (!mod) continue

    for (const dep of mod.importedIds) {
      if (!reachable.has(dep)) queue.push(dep)
    }
  }

  return reachable
}
