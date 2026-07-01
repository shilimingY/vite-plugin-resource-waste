/**
 * 分析器调度中心
 * 负责并行运行各 analyzer、去重、按优先级排序
 */
import { analyzeCacheStrategy } from './cache-analyzer'
import { analyzeDuplicateDependencies, analyzeUnusedExports } from './duplicate-deps-analyzer'
import { analyzeImportPatterns } from './import-pattern-analyzer'
import { analyzeUnusedImports } from './unused-import-analyzer'
import { analyzeOrphanChunks, analyzeUnreachableFiles } from './unreachable-analyzer'
import type { AnalysisContext, ResourceIssue } from '../types'

/** 并行运行所有分析器，合并结果并去重 */
export async function runAllAnalyzers(ctx: AnalysisContext): Promise<ResourceIssue[]> {
  const results = await Promise.all([
    analyzeImportPatterns(ctx), // 低效 import 模式、barrel 文件等
    Promise.resolve(analyzeUnusedImports(ctx)), // 未使用的本地静态 import
    Promise.resolve(analyzeUnreachableFiles(ctx)), // 静态不可达源文件
    Promise.resolve(analyzeOrphanChunks(ctx)), // 仅动态引用的 async chunk
    Promise.resolve(analyzeCacheStrategy(ctx)), // 产物 cache 策略
    Promise.resolve(analyzeDuplicateDependencies(ctx)), // 重复 npm 依赖版本
    Promise.resolve(analyzeUnusedExports(ctx)), // 疑似过多 export
  ])

  return dedupeIssues(results.flat())
}

/** 按 category + file + title 去重，避免同一问题重复报告 */
function dedupeIssues(issues: ResourceIssue[]): ResourceIssue[] {
  const seen = new Set<string>()
  return issues.filter((issue) => {
    const key = `${issue.category}:${issue.file}:${issue.title}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * 问题排序：先按严重级别（high → low），再按浪费体积降序
 * 便于报告 Top issues 展示最需要优先处理的问题
 */
export function sortIssues(issues: ResourceIssue[]): ResourceIssue[] {
  const severityOrder = { high: 0, medium: 1, low: 2 }
  return [...issues].sort((a, b) => {
    const s = severityOrder[a.severity] - severityOrder[b.severity]
    if (s !== 0) return s
    return b.cost.transferKb - a.cost.transferKb
  })
}
