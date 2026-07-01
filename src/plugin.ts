/**
 * Vite 插件主入口 —— vite-plugin-resource-waste
 *
 * 前端资源浪费分析插件，在构建期检测无效 JS、不可达组件、缓存失效等问题并生成报告。
 * 1. configResolved  → 读取项目根目录、输出目录、构建入口
 * 2. buildStart       → glob 扫描全部源文件
 * 3. moduleParsed     → 记录模块依赖图（import / 被 import）
 * 4. generateBundle   → 缓存 Rollup 产出 bundle
 * 5. closeBundle      → 运行分析器、生成 JSON/HTML 报告
 * 6. configureServer  → dev 模式下做轻量静态分析，写入 cache
 */
import fs from 'node:fs'
import path from 'node:path'
import type { OutputBundle } from 'rollup'
import type { Plugin as VitePlugin } from 'vite'
import { runAllAnalyzers, sortIssues } from './analyzers'
import { extractBundleFiles, recordModuleParsed } from './analyzers/module-graph-analyzer'
import { collectSourceFiles } from './analyzers/import-pattern-analyzer'
import { DEFAULT_OPTIONS } from './constants'
import { buildReport, printTerminalSummary } from './report/reporter'
import type { AnalysisContext, ParsedModuleInfo, ResourceWastePluginOptions } from './types'
import { ensureDir, normalizePath, resolveFromRoot } from './utils/fs'

/** 终端 ANSI 着色（替代 picocolors，零依赖） */
const ansi = {
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
}

/** 插件内部状态：保存 generateBundle 阶段的 bundle 供 closeBundle 使用 */
type PluginState = {
  bundle?: OutputBundle
}

export function resourceWaste(options: ResourceWastePluginOptions = {}): VitePlugin {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const state: PluginState = {}

  // 以下变量在 configResolved 后赋值，供整个构建周期使用
  let projectRoot = process.cwd()
  let outDir = 'dist'
  let mode = 'production'
  let entries: string[] = []
  let sourceFiles: string[] = []

  // 模块依赖图：key 为模块绝对路径，value 为 ParsedModuleInfo
  const parsedModules = new Map<string, ParsedModuleInfo>()

  /** 构造分析上下文，供各 analyzer 读取共享数据 */
  const createContext = (bundleFiles: AnalysisContext['bundleFiles'] = []): AnalysisContext => ({
    root: opts.root ?? 'src',
    projectRoot,
    outDir,
    mode,
    entries,
    sourceFiles,
    parsedModules,
    bundleFiles,
    options: opts,
  })

  /**
   * 构建完成后：运行全部分析器 → 写报告 → 可选 fail build
   */
  async function writeReport(): Promise<void> {
    if (!state.bundle) return

    const bundleFiles = extractBundleFiles(state.bundle)
    const ctx = createContext(bundleFiles)
    const issues = sortIssues(await runAllAnalyzers(ctx))
    const report = buildReport(issues, { projectRoot, mode, outDir })

    const reportBaseDir = path.resolve(projectRoot, outDir, opts.reportDir ?? 'resource-waste')
    ensureDir(reportBaseDir)

    // 写入 JSON 报告（供 CI / 程序消费）
    const jsonPath = path.join(reportBaseDir, 'report.json')
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8')

    // HTML 报告按需 dynamic import，未开启时不加载 html 模块
    if (opts.htmlReport) {
      const { renderHtmlReport } = await import('./report/html.js')
      fs.writeFileSync(path.join(reportBaseDir, 'report.html'), renderHtmlReport(report), 'utf-8')
    }

    if (!opts.silent) {
      printTerminalSummary(report, opts.wasteThresholdKb ?? 300)
      console.log(`  Report JSON : ${normalizePath(path.relative(projectRoot, jsonPath))}`)
      if (opts.htmlReport) {
        console.log(
          `  Report HTML : ${normalizePath(path.relative(projectRoot, path.join(reportBaseDir, 'report.html')))}`,
        )
      }
    }

    // CI 构建阈值拦截：浪费超过阈值则中断构建
    if (opts.failOnThreshold && report.summary.totalWasteTransferKb > (opts.wasteThresholdKb ?? 300)) {
      throw new Error(
        `[vite-plugin-resource-waste] Estimated waste ${report.summary.totalWasteTransferKb} KB exceeds threshold ${opts.wasteThresholdKb} KB`,
      )
    }
  }

  return {
    name: 'vite-plugin-resource-waste',
    enforce: 'post', // 在其他插件之后执行，确保 module graph 和 bundle 已完整

    /** Vite 配置解析完成后，收集构建入口等信息 */
    configResolved(config) {
      projectRoot = config.root
      outDir = config.build.outDir
      mode = config.mode

      // 解析 rollup input 配置，支持 string / string[] / Record 三种形式
      const rollupInput = config.build.rollupOptions.input
      if (typeof rollupInput === 'string') {
        entries = [normalizePath(resolveFromRoot(projectRoot, rollupInput))]
      } else if (Array.isArray(rollupInput)) {
        entries = rollupInput.map((e) => normalizePath(resolveFromRoot(projectRoot, e)))
      } else if (rollupInput && typeof rollupInput === 'object') {
        entries = Object.values(rollupInput).map((e) => normalizePath(resolveFromRoot(projectRoot, e)))
      } else {
        // 未显式配置 input 时，默认以 index.html 为入口
        entries = [normalizePath(resolveFromRoot(projectRoot, 'index.html'))]
      }
    },

    /** 构建开始时 glob 扫描 src 下全部源文件 */
    async buildStart() {
      sourceFiles = await collectSourceFiles(createContext())
    },

    /**
     * 每个模块被 Rollup 解析后触发
     * 用于构建 import 依赖图（谁引用了谁）
     */
    moduleParsed(moduleInfo) {
      if (!moduleInfo.id) return

      recordModuleParsed(
        parsedModules,
        moduleInfo.id,
        moduleInfo.code ?? null,
        [...moduleInfo.importedIds, ...(moduleInfo.dynamicallyImportedIds ?? [])],
        moduleInfo.isEntry,
      )
    },

    /** 构建产出阶段：缓存 bundle 对象，closeBundle 时再分析 */
    generateBundle(_options, bundle) {
      state.bundle = bundle
    },

    /** 构建结束：执行分析并写报告 */
    async closeBundle() {
      await writeReport()
    },

    /**
     * dev server 启动后：做轻量静态分析（无 bundle 数据）
     * 报告写入 node_modules/.cache/resource-waste/dev-report.json
     */
    configureServer(server) {
      server.httpServer?.once('listening', async () => {
        if (mode === 'production') return

        sourceFiles = await collectSourceFiles(createContext())
        const issues = sortIssues(await runAllAnalyzers(createContext()))

        if (!opts.silent && issues.length > 0) {
          console.log(
            ansi.cyan('\n[vite-plugin-resource-waste]') +
              ansi.yellow(
                ` Dev mode: found ${issues.length} potential resource waste issue(s). Run "vite build" for full report.\n`,
              ),
          )
        }

        const cacheDir = path.resolve(projectRoot, 'node_modules/.cache/resource-waste')
        ensureDir(cacheDir)
        const report = buildReport(issues, { projectRoot, mode, outDir })
        fs.writeFileSync(path.join(cacheDir, 'dev-report.json'), JSON.stringify(report, null, 2), 'utf-8')
      })
    },
  }
}

export default resourceWaste

export type {
  ResourceWastePluginOptions,
  ResourceWasteReport,
  ResourceIssue,
  ResourceWasteSummary,
} from './types'
