/**
 * Module Graph 与 Bundle 产物解析
 *
 * - recordModuleParsed：在 moduleParsed 钩子中累积模块依赖关系
 * - extractBundleFiles：从 Rollup OutputBundle 提取 chunk/asset 元信息
 */
import type { OutputBundle, OutputChunk, OutputAsset } from 'rollup'
import type { BundleFileInfo, ParsedModuleInfo } from '../types'
import { normalizePath } from '../utils/fs'

/**
 * 记录单个模块的解析结果，并维护双向依赖关系
 * @param parsedModules 全局模块图 Map
 * @param id 模块 id（通常是绝对路径）
 * @param code 模块源码（可选，用于 export 分析）
 * @param importedIds 该模块 import 的模块 id 列表
 * @param isEntry 是否为构建入口
 */
export function recordModuleParsed(
  parsedModules: Map<string, ParsedModuleInfo>,
  id: string,
  code: string | null,
  importedIds: string[],
  isEntry: boolean,
): void {
  const normalizedId = normalizePath(id)

  // 获取或初始化当前模块节点
  const existing = parsedModules.get(normalizedId) ?? {
    id: normalizedId,
    importers: new Set<string>(),
    importedIds: new Set<string>(),
    dynamicImporters: new Set<string>(),
    isEntry: false,
    code: undefined,
  }

  existing.isEntry = existing.isEntry || isEntry
  if (code) existing.code = code

  // 记录本模块 → 依赖模块 的边
  for (const dep of importedIds) {
    existing.importedIds.add(normalizePath(dep))
  }
  parsedModules.set(normalizedId, existing)

  // 反向记录 依赖模块 → 本模块 的 importers 边
  for (const dep of importedIds) {
    const depId = normalizePath(dep)
    const depMod = parsedModules.get(depId) ?? {
      id: depId,
      importers: new Set<string>(),
      importedIds: new Set<string>(),
      dynamicImporters: new Set<string>(),
      isEntry: false,
    }
    depMod.importers.add(normalizedId)
    parsedModules.set(depId, depMod)
  }
}

/**
 * 将 Rollup 的 OutputBundle 转为统一的 BundleFileInfo 数组
 * 供 cache-analyzer、duplicate-deps-analyzer 等使用
 */
export function extractBundleFiles(bundle: OutputBundle): BundleFileInfo[] {
  const files: BundleFileInfo[] = []

  for (const [fileName, item] of Object.entries(bundle)) {
    if (item.type === 'chunk') {
      const chunk = item as OutputChunk
      files.push({
        fileName,
        type: 'chunk',
        size: Buffer.byteLength(chunk.code, 'utf-8'),
        modules: Object.keys(chunk.modules ?? {}),
        isEntry: chunk.isEntry ?? false,
        imports: chunk.imports,
        dynamicImports: chunk.dynamicImports,
      })
    } else {
      const asset = item as OutputAsset
      const source = asset.source
      // asset 可能是 string 或 Uint8Array
      const size =
        typeof source === 'string'
          ? Buffer.byteLength(source, 'utf-8')
          : source instanceof Uint8Array
            ? source.byteLength
            : 0

      files.push({
        fileName,
        type: 'asset',
        size,
      })
    }
  }

  return files
}
