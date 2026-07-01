/**
 * 文件系统与路径相关的通用工具函数
 * 供各 analyzer 和 plugin 主逻辑复用
 */
import fs from 'node:fs'
import path from 'node:path'

/** 统一路径分隔符为 `/`，便于跨平台比较 */
export function normalizePath(p: string): string {
  return p.split(path.sep).join('/')
}

/** 判断是否为前端源码文件 */
export function isSourceFile(filePath: string): boolean {
  return /\.(tsx?|jsx?|vue|svelte)$/.test(filePath)
}

/** 安全读取文本文件，失败时返回空字符串而不抛错 */
export function readTextSafe(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8')
  } catch {
    return ''
  }
}

/** 获取文件体积（KB），保留两位小数 */
export function fileSizeKb(filePath: string): number {
  try {
    const stat = fs.statSync(filePath)
    return Math.round((stat.size / 1024) * 100) / 100
  } catch {
    return 0
  }
}

/** 根据体积估算 JS 解析耗时（ms） */
export function estimateParseMs(kb: number): number {
  return Math.round(kb * 0.45 * 10) / 10
}

/**
 * 从 Rollup module id 中提取 npm 包名与版本
 * 例：/project/node_modules/lodash/lodash.js → { name: 'lodash', version: '4.17.21' }
 */
export function extractPackageFromModuleId(moduleId: string): { name: string; version?: string } | null {
  const normalized = normalizePath(moduleId)
  const nodeModulesIdx = normalized.lastIndexOf('node_modules/')
  if (nodeModulesIdx === -1) return null

  const nodeModulesRoot = normalized.slice(0, nodeModulesIdx + 'node_modules/'.length)
  const rest = normalized.slice(nodeModulesIdx + 'node_modules/'.length)
  const parts = rest.split('/')

  // scoped 包：@scope/name
  if (parts[0]?.startsWith('@') && parts[1]) {
    const name = `${parts[0]}/${parts[1]}`
    const version = readPackageVersion(path.join(nodeModulesRoot, name))
    return { name, version }
  }

  // 普通包：lodash、vue 等
  if (parts[0]) {
    const name = parts[0]
    const version = readPackageVersion(path.join(nodeModulesRoot, name))
    return { name, version }
  }

  return null
}

/** 读取 node_modules 中某包的 package.json version 字段 */
function readPackageVersion(packageDir: string): string | undefined {
  try {
    const pkgPath = path.join(packageDir, 'package.json')
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version?: string }
    return pkg.version
  } catch {
    return undefined
  }
}

/** 将相对路径解析为基于项目根的绝对路径 */
export function resolveFromRoot(projectRoot: string, maybeRelative: string): string {
  if (path.isAbsolute(maybeRelative)) return maybeRelative
  return path.resolve(projectRoot, maybeRelative)
}

/** 生成 issue 唯一 id */
export function uniqueId(prefix: string, index: number): string {
  return `${prefix}-${index}`
}

/** 格式化为本地时区的可读时间（避免 toISOString 的 UTC 偏差） */
export function formatLocalDateTime(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`
}

/** 格式化体积显示（KB 或 MB） */
export function formatKb(kb: number): string {
  if (kb >= 1024) return `${(kb / 1024).toFixed(2)} MB`
  return `${kb.toFixed(2)} KB`
}

/** 递归创建目录 */
export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

/** 绝对路径转相对项目根的路径 */
export function toRelative(projectRoot: string, absPath: string): string {
  return normalizePath(path.relative(projectRoot, absPath))
}
