/**
 * 重复依赖 & 过多 Export 分析器
 *
 * - analyzeDuplicateDependencies：同一 npm 包在产物中出现多个版本
 * - analyzeUnusedExports：启发式检测 export 过多但引用者极少的模块
 */
import type { AnalysisContext, ResourceIssue } from '../types'
import { estimateParseMs, extractPackageFromModuleId, uniqueId } from '../utils/fs'

/**
 * 遍历 bundle 中各 chunk 的 modules，统计 npm 包版本
 * 若同一包名对应多个 version → 报告重复依赖问题
 */
export function analyzeDuplicateDependencies(ctx: AnalysisContext): ResourceIssue[] {
  if (!ctx.options.scanDuplicateDeps) return []

  // packageName → (version → 引用次数)
  const packageVersions = new Map<string, Map<string, number>>()
  let index = 0
  const issues: ResourceIssue[] = []

  for (const bundleFile of ctx.bundleFiles) {
    if (bundleFile.type !== 'chunk') continue

    for (const moduleId of bundleFile.modules ?? []) {
      const pkg = extractPackageFromModuleId(moduleId)
      if (!pkg?.version) continue

      if (!packageVersions.has(pkg.name)) {
        packageVersions.set(pkg.name, new Map())
      }
      const versions = packageVersions.get(pkg.name)!
      versions.set(pkg.version, (versions.get(pkg.version) ?? 0) + 1)
    }
  }

  for (const [name, versions] of packageVersions) {
    if (versions.size <= 1) continue

    const versionList = [...versions.entries()]
    const totalRefs = versionList.reduce((sum, [, count]) => sum + count, 0)
    // 粗略估算：每个重复引用约 3KB 浪费
    const wasteKb = Math.max(5, Math.round(totalRefs * 3))

    issues.push({
      id: uniqueId('duplicate-dep', index++),
      category: 'duplicate-dependency',
      severity: 'medium',
      title: `重复依赖版本: ${name}`,
      file: name,
      detail: `依赖 ${name} 在产物中出现多个版本: ${versionList.map(([v, c]) => `${v}(${c}次)`).join(', ')}。`,
      suggestion: `使用 package.json overrides / pnpm.overrides 统一 ${name} 版本，避免重复打包与缓存失效。`,
      cost: {
        transferKb: wasteKb,
        parseMsEstimate: estimateParseMs(wasteKb),
        description: `预估重复传输约 ${wasteKb} KB`,
      },
      metadata: {
        packageName: name,
        versions: Object.fromEntries(versionList),
      },
    })
  }

  return issues
}

/**
 * 启发式检测「疑似过多未使用 export」
 * 条件：export 数量 >= 8 且 importers <= 1
 * 注意：这是保守信号，需结合 Knip/ESLint 进一步确认
 */
export function analyzeUnusedExports(ctx: AnalysisContext): ResourceIssue[] {
  const issues: ResourceIssue[] = []
  let index = 0

  for (const [moduleId, mod] of ctx.parsedModules) {
    if (moduleId.includes('node_modules') || moduleId.startsWith('\0')) continue
    if (!mod.code) continue

    const exportMatches = [...mod.code.matchAll(/export\s+(?:const|function|class|type|interface)\s+(\w+)/g)]
    if (exportMatches.length === 0) continue

    if (exportMatches.length >= 8 && mod.importers.size <= 1) {
      const sizeEstimate = Math.round((mod.code.length / 1024) * 0.3)

      issues.push({
        id: uniqueId('unused-export', index++),
        category: 'static-unused-js',
        severity: 'low',
        title: '疑似过多未使用 export',
        file: moduleId,
        detail: `${moduleId} 导出了 ${exportMatches.length} 个符号，但仅被 ${mod.importers.size} 个模块引用，可能存在未使用的 export。`,
        suggestion: '使用 Knip 或 ESLint 进一步确认，移除未使用的 export 以改善 tree-shaking。',
        cost: {
          transferKb: sizeEstimate,
          parseMsEstimate: estimateParseMs(sizeEstimate),
          description: '保守估计，需结合静态分析工具确认',
        },
        metadata: {
          exportCount: exportMatches.length,
          importerCount: mod.importers.size,
        },
      })
    }
  }

  return issues
}
