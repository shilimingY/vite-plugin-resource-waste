/**
 * 插件类型定义
 * 包含：配置项、问题项、报告结构、分析上下文等核心数据结构
 */

/** 问题严重级别：高 / 中 / 低 */
export type IssueSeverity = 'high' | 'medium' | 'low'

/** 问题分类，对应不同分析器产出的 issue 类型 */
export type IssueCategory =
  | 'static-unused-js' // 静态未使用 JS（含过多 export、async chunk 等）
  | 'unreachable-component' // 不可达组件/页面
  | 'cache-miss' // 缓存策略风险（文件名无 hash 等）
  | 'duplicate-dependency' // 同一 npm 包多版本共存
  | 'import-pattern' // 低效 import 模式（如 lodash 全量导入）
  | 'dead-import' // 未使用的静态 import（已引入但未引用）
  | 'prefetch-waste' // 预加载浪费（预留分类，便于后续扩展）

/** 插件用户可配置项 */
export interface ResourceWastePluginOptions {
  /** 源码根目录，默认 src */
  root?: string
  /** 报告输出目录，相对 outDir，默认 resource-waste */
  reportDir?: string
  /** 预估浪费阈值（KB），超出则在终端提示，配合 failOnThreshold 可用于 CI 拦截 */
  wasteThresholdKb?: number
  /** 超出阈值是否在构建时抛出错误（用于 CI 构建阈值拦截） */
  failOnThreshold?: boolean
  /** 是否生成 HTML 报告 */
  htmlReport?: boolean
  /** 是否扫描 import 模式问题 */
  scanImportPatterns?: boolean
  /** 是否扫描未使用的本地静态 import */
  scanUnusedImports?: boolean
  /** 是否扫描不可达文件 */
  scanUnreachable?: boolean
  /** 是否分析产物 cache 策略 */
  scanCacheStrategy?: boolean
  /** 是否检测重复依赖 */
  scanDuplicateDeps?: boolean
  /** glob 扫描额外包含的文件模式 */
  include?: string[]
  /** 排除扫描的路径 */
  exclude?: string[]
  /** 静默模式，不输出终端摘要 */
  silent?: boolean
}

/** 单项问题的成本估算 */
export interface CostEstimate {
  transferKb: number // 预估额外传输体积（KB）
  parseMsEstimate: number // 预估额外 JS 解析耗时（ms）
  description: string // 成本说明文字
}

/** 单条资源浪费问题 */
export interface ResourceIssue {
  id: string
  category: IssueCategory
  severity: IssueSeverity
  title: string
  file?: string // 关联文件路径（相对项目根）
  detail: string // 问题详情描述
  suggestion: string // 修复建议
  cost: CostEstimate
  metadata?: Record<string, unknown> // 扩展信息，如 informational: true 表示不计入浪费总量
}

/** 报告摘要统计 */
export interface ResourceWasteSummary {
  totalIssues: number
  totalWasteTransferKb: number
  totalParseMsEstimate: number
  byCategory: Record<IssueCategory, number>
  bySeverity: Record<IssueSeverity, number>
}

/** 完整分析报告结构（JSON 输出格式） */
export interface ResourceWasteReport {
  generatedAt: string // 本地时区，格式 YYYY-MM-DD HH:mm:ss
  projectRoot: string
  mode: string
  outDir: string
  summary: ResourceWasteSummary
  issues: ResourceIssue[]
}

/**
 * 构建期 module graph 中单个模块的元信息
 * 由 Vite/Rollup 的 moduleParsed 钩子逐步填充
 */
export interface ParsedModuleInfo {
  id: string
  importers: Set<string> // 哪些模块 import 了本模块
  importedIds: Set<string> // 本模块 import 了哪些模块
  dynamicImporters: Set<string> // 动态 import 方（预留）
  isEntry: boolean // 是否为构建入口
  code?: string // 模块源码，用于 export 数量等启发式分析
}

/** 构建产物中的单个文件（chunk 或 asset）信息 */
export interface BundleFileInfo {
  fileName: string
  type: 'chunk' | 'asset'
  size: number // 字节数
  modules?: string[] // chunk 包含的模块 id 列表
  isEntry?: boolean
  imports?: string[] // 静态 import 的其他 chunk
  dynamicImports?: string[] // 动态 import 的其他 chunk
}

/**
 * 分析上下文：贯穿整个构建生命周期，供各 analyzer 共享数据
 */
export interface AnalysisContext {
  root: string
  projectRoot: string
  outDir: string
  mode: string
  entries: string[] // 构建入口绝对路径
  sourceFiles: string[] // glob 扫描到的全部源文件
  parsedModules: Map<string, ParsedModuleInfo> // 模块依赖图
  bundleFiles: BundleFileInfo[] // 构建产物文件列表
  options: Required<
    Pick<
      ResourceWastePluginOptions,
      | 'reportDir'
      | 'wasteThresholdKb'
      | 'failOnThreshold'
      | 'htmlReport'
      | 'scanImportPatterns'
      | 'scanUnusedImports'
      | 'scanUnreachable'
      | 'scanCacheStrategy'
      | 'scanDuplicateDeps'
      | 'include'
      | 'exclude'
      | 'silent'
    >
  > &
    ResourceWastePluginOptions
}
