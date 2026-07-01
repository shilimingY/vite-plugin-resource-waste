/**
 * 插件常量与默认配置
 */
import type { IssueSeverity } from './types'

export const DEFAULT_OPTIONS = {
  root: 'src',
  reportDir: 'resource-waste',
  wasteThresholdKb: 300,
  failOnThreshold: false,
  htmlReport: true,
  scanImportPatterns: true,
  scanUnusedImports: true,
  scanUnreachable: true,
  scanCacheStrategy: true,
  scanDuplicateDeps: true,
  include: [] as string[],
  exclude: ['**/*.spec.*', '**/*.test.*', '**/__tests__/**', '**/node_modules/**'],
  silent: false,
}

export const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.vue', '.svelte']

export const CACHEABLE_EXTENSIONS = [
  '.js', '.css', '.woff', '.woff2', '.ttf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico',
]

export const HASH_IN_FILENAME =
  /\.[a-f0-9]{8,}\.(js|css|woff2?|ttf|png|jpe?g|gif|webp|svg|ico)$/i

/** 导入模式检测：正则 + 包名 + 严重级别 + 预估体积(KB) */
export const IMPORT_PATTERN_RULES: Array<[RegExp, string, IssueSeverity, number]> = [
  [/import\s+_\s+from\s+['"]lodash['"]/, 'lodash', 'high', 68],
  [/import\s+\*\s+as\s+\w+\s+from\s+['"]lodash['"]/, 'lodash', 'high', 68],
  [/import\s+\w+\s+from\s+['"]moment['"]/, 'moment', 'high', 65],
  [/import\s+\*\s+as\s+\w+\s+from\s+['"]antd['"]/, 'antd', 'high', 200],
  [/import\s+\*\s+as\s+\w+\s+from\s+['"]@ant-design\/icons['"]/, '@ant-design/icons', 'medium', 80],
  [/import\s+['"][^'"]+\.css['"]\s*;\s*\/\/\s*unused/i, 'css', 'medium', 10],
]

/** 修复建议（按包名索引，避免在规则表中重复长字符串） */
export const IMPORT_SUGGESTIONS: Record<string, string> = {
  lodash: "改为 import debounce from 'lodash-es/debounce' 或按需导入",
  moment: '改用 dayjs 或 date-fns 按需导入',
  antd: '改用 antd 按需导入或 unplugin-vue-components',
  '@ant-design/icons': '改为按需导入具体图标',
  css: '移除未使用的 CSS 副作用 import',
}
