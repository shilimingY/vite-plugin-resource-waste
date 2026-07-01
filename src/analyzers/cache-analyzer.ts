/**
 * 缓存策略分析器
 *
 * 检测构建产物中静态资源文件名是否包含 content hash（无 hash → 难以长期缓存）
 */
import { CACHEABLE_EXTENSIONS, HASH_IN_FILENAME } from '../constants'
import type { AnalysisContext, ResourceIssue } from '../types'
import { estimateParseMs, uniqueId } from '../utils/fs'

export function analyzeCacheStrategy(ctx: AnalysisContext): ResourceIssue[] {
  if (!ctx.options.scanCacheStrategy) return []

  const issues: ResourceIssue[] = []
  let index = 0

  for (const file of ctx.bundleFiles) {
    if (file.type !== 'asset') continue

    const ext = getExtension(file.fileName)
    if (!CACHEABLE_EXTENSIONS.includes(ext)) continue

    const sizeKb = Math.round((file.size / 1024) * 100) / 100
    const hasHash = HASH_IN_FILENAME.test(file.fileName)

    if (!hasHash) {
      const isFont = /\.(woff2?|ttf|otf)$/i.test(file.fileName)
      const isLargeAsset = sizeKb > 100

      issues.push({
        id: uniqueId('cache-miss', index++),
        category: 'cache-miss',
        severity: isLargeAsset || isFont ? 'high' : 'medium',
        title: '产物文件名缺少 content hash',
        file: file.fileName,
        detail: `静态资源 ${file.fileName} (${sizeKb} KB) 未包含 content hash，浏览器难以安全长期缓存，回访用户可能重复下载。`,
        suggestion: isFont
          ? '配置 vite build.assetsInlineLimit 与 rollup assetFileNames 含 [hash]；CDN 设置 immutable 缓存。'
          : '在 vite.config 中设置 build.rollupOptions.output.assetFileNames 包含 [hash] 占位符。',
        cost: {
          transferKb: sizeKb,
          parseMsEstimate: isFont ? estimateParseMs(sizeKb * 0.1) : 0,
          description: isLargeAsset
            ? `回访用户可能重复传输 ${sizeKb} KB`
            : '缓存命中率低导致重复验证成本',
        },
        metadata: {
          sizeKb,
          extension: ext,
          hasContentHash: false,
        },
      })
    }
  }

  return issues
}

/** 提取文件扩展名（含点，小写） */
function getExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.')
  return idx === -1 ? '' : fileName.slice(idx).toLowerCase()
}
