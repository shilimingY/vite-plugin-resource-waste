/**
 * tsup 构建配置
 *
 * - 仅 ESM（Vite 生态标配，省去一份 CJS 产物）
 * - splitting + dynamic import：HTML 报告独立 chunk，主入口更小
 * - minify + treeshake + 无 sourcemap（默认）
 */
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  minify: true,
  treeshake: true,
  splitting: true,
  sourcemap: process.argv.includes('--sourcemap'),
  target: 'node18',
  external: ['vite', 'rollup'],
  esbuildOptions(options) {
    options.legalComments = 'none'
  },
})
