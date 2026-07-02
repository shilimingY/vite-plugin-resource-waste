/**
 * HTML 报告（独立模块，构建时按需 dynamic import，减小主包体积）
 */
import type { ResourceWasteReport } from '../types'

const CAT: Record<string, string> = {
  'static-unused-js': '静态未使用 JS',
  'unreachable-component': '不可达组件/页面',
  'cache-miss': '缓存策略风险',
  'duplicate-dependency': '重复依赖',
  'import-pattern': '导入模式浪费',
  'dead-import': '未使用 import',
  'prefetch-waste': '预加载浪费',
}

const SEV: Record<string, string> = { high: '高', medium: '中', low: '低' }

/** 极简 HTML 壳 */
const SHELL =
  '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"/>' +
  '<meta name="viewport" content="width=device-width,initial-scale=1"/>' +
  '<title>Resource Waste Report</title>' +
  '<style>body{font:14px/1.5 system-ui,sans-serif;margin:20px;color:#1e293b}' +
  'table{border-collapse:collapse;width:100%;margin-top:12px}' +
  'td,th{border:1px solid #cbd5e1;padding:8px;text-align:left;vertical-align:top}' +
  'th{background:#f1f5f9}.badge{font-size:12px;font-weight:600}' +
  '.cards{display:flex;flex-wrap:wrap;gap:12px;margin:12px 0}.card{border:1px solid #cbd5e1;border-radius:8px;padding:10px 14px;min-width:120px}' +
  '.muted{color:#64748b;font-size:13px}code{font-size:12px;background:#f1f5f9;padding:2px 4px}</style></head><body>' +
  '<h1>前端资源浪费分析报告</h1><p class="muted">{{META}}</p><div class="cards">{{SUMMARY}}</div>' +
  '<table><thead><tr><th>级别</th><th>类别</th><th>问题</th><th>文件</th><th>传输</th><th>解析</th><th>建议</th></tr></thead>' +
  '<tbody>{{ROWS}}</tbody></table><p class="muted">{{LEGEND}}</p></body></html>'

export function renderHtmlReport(report: ResourceWasteReport): string {
  const { summary, issues } = report

  const rows = issues
    .map(
      (i) =>
        `<tr><td class="badge">${SEV[i.severity]}</td><td>${CAT[i.category]}</td>` +
        `<td><b>${esc(i.title)}</b><br/><span class="muted">${esc(i.detail)}</span></td>` +
        `<td><code>${esc(i.file ?? '-')}</code></td>` +
        `<td>${i.cost.transferKb > 0 ? i.cost.transferKb + ' KB' : '-'}</td>` +
        `<td>${i.cost.parseMsEstimate > 0 ? i.cost.parseMsEstimate + ' ms' : '-'}</td>` +
        `<td>${esc(i.suggestion)}</td></tr>`,
    )
    .join('')

  const cards =
    card('问题总数', summary.totalIssues) +
    card('浪费传输', summary.totalWasteTransferKb + ' KB') +
    card('浪费解析', summary.totalParseMsEstimate + ' ms') +
    card('高危', summary.bySeverity.high)

  return SHELL.replace('{{META}}', `生成: ${report.generatedAt} · 模式: ${report.mode}`)
    .replace('{{SUMMARY}}', cards)
    .replace('{{ROWS}}', rows || '<tr><td colspan="7">未检测到资源浪费问题</td></tr>')
    .replace(
      '{{LEGEND}}',
      '构建期静态分析',
    )
}

function card(label: string, value: string | number): string {
  return `<div class="card"><div class="muted">${label}</div><div><b>${value}</b></div></div>`
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
