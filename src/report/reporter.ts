/**
 * 报告生成模块（JSON 摘要 + 终端输出；HTML 见 html.ts 按需加载）
 */
import type { IssueCategory, IssueSeverity, ResourceWasteReport, ResourceIssue } from '../types'
import { formatLocalDateTime } from '../utils/fs'

export function buildReport(
  issues: ResourceIssue[],
  meta: { projectRoot: string; mode: string; outDir: string },
): ResourceWasteReport {
  const byCategory = emptyCategoryCount()
  const bySeverity: Record<IssueSeverity, number> = { high: 0, medium: 0, low: 0 }
  let totalWasteTransferKb = 0
  let totalParseMsEstimate = 0

  for (const issue of issues) {
    byCategory[issue.category]++
    bySeverity[issue.severity]++
    if (issue.metadata?.informational) continue
    totalWasteTransferKb += issue.cost.transferKb
    totalParseMsEstimate += issue.cost.parseMsEstimate
  }

  return {
    generatedAt: formatLocalDateTime(),
    projectRoot: meta.projectRoot,
    mode: meta.mode,
    outDir: meta.outDir,
    summary: {
      totalIssues: issues.length,
      totalWasteTransferKb: Math.round(totalWasteTransferKb * 100) / 100,
      totalParseMsEstimate: Math.round(totalParseMsEstimate * 10) / 10,
      byCategory,
      bySeverity,
    },
    issues,
  }
}

function emptyCategoryCount(): Record<IssueCategory, number> {
  return {
    'static-unused-js': 0,
    'unreachable-component': 0,
    'cache-miss': 0,
    'duplicate-dependency': 0,
    'import-pattern': 0,
    'dead-import': 0,
    'prefetch-waste': 0,
  }
}

export function printTerminalSummary(report: ResourceWasteReport, thresholdKb: number): void {
  const { summary, issues } = report
  const top = issues.slice(0, 5)

  console.log('\n[vite-plugin-resource-waste] Resource waste analysis complete\n')
  console.log(`  Issues       : ${summary.totalIssues}`)
  console.log(`  Waste (est.) : ${summary.totalWasteTransferKb} KB transfer / ${summary.totalParseMsEstimate} ms parse`)
  console.log(`  Threshold    : ${thresholdKb} KB`)

  if (top.length > 0) {
    console.log('\n  Top issues:')
    for (const issue of top) {
      console.log(`    [${issue.severity.toUpperCase()}] ${issue.title}${issue.file ? ` (${issue.file})` : ''}`)
    }
  }
  console.log('')
}
