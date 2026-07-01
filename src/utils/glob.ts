/**
 * 轻量文件遍历，替代 fast-glob，避免打包体积膨胀
 */
import fs from 'node:fs'
import path from 'node:path'
import { normalizePath } from './fs'

/** 简单 glob 忽略规则匹配 */
function shouldIgnore(relativePath: string, ignorePatterns: string[]): boolean {
  const p = normalizePath(relativePath)
  for (const pattern of ignorePatterns) {
    if (pattern.includes('*.spec.') && /\.spec\.(tsx?|jsx?)$/.test(p)) return true
    if (pattern.includes('*.test.') && /\.test\.(tsx?|jsx?)$/.test(p)) return true
    if (pattern.includes('__tests__') && p.includes('__tests__')) return true
    if (pattern.includes('node_modules') && p.includes('node_modules')) return true
  }
  return false
}

/**
 * 递归收集目录下匹配扩展名的文件
 * @param rootDir 扫描根目录
 * @param extensions 扩展名列表，如 ['.ts', '.vue']
 * @param ignore 忽略规则（与 DEFAULT_OPTIONS.exclude 一致）
 */
export function collectFilesRecursive(
  rootDir: string,
  extensions: string[],
  ignore: string[],
): string[] {
  const results: string[] = []
  const extSet = new Set(extensions.map((e) => e.toLowerCase()))

  function walk(currentDir: string): void {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const abs = path.join(currentDir, entry.name)
      const rel = normalizePath(path.relative(rootDir, abs))

      if (entry.isDirectory()) {
        if (shouldIgnore(rel + '/', ignore)) continue
        walk(abs)
        continue
      }

      if (!entry.isFile() || shouldIgnore(rel, ignore)) continue

      const ext = path.extname(entry.name).toLowerCase()
      if (extSet.has(ext)) results.push(normalizePath(abs))
    }
  }

  walk(rootDir)
  return results
}
