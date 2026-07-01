# vite-plugin-resource-waste

基于 Vite/Rollup Module Graph 的前端资源浪费分析插件

---

## 为什么需要它？

很多团队只关注「包体积多少 KB」，却忽略了更隐蔽的浪费：

- `import _ from 'lodash'` 只用了 `debounce`，tree-shake 失效，整包进 bundle；
- 活动页下线了，组件文件还在 `src/pages/legacy/` 里；
- 字体/图片产物没有 content hash，回访用户每次重复下载；
- 同一依赖两个版本，重复打包 + 缓存失效；

**vite-plugin-resource-waste** 在 `vite build` 时自动分析这些问题，把「浪费」量化为 **传输体积（KB）+ 解析耗时（ms）**，并给出可执行的修复建议。

> 本插件分析的是 **构建冗余、导入模式、未使用 import、不可达代码、缓存策略、重复依赖** 等多维浪费。

---

## 特点与优势

| 对比维度 | 传统 Bundle 分析器 | vite-plugin-resource-waste |
|---|---|---|
| 分析视角 | 产物有多大 | **浪费了多少、为什么浪费** |
| 问题类型 | 体积分布图 | 低效 import、不可达页面、cache 风险、重复依赖 |
| 输出形式 | Treemap 可视化 | **JSON + HTML 报告 + 终端摘要 + 修复建议** |
| 工程集成 | 人工解读 | **CI 构建阈值拦截**（`failOnThreshold`） |
| 分析深度 | 产物层 | **源码 + Module Graph + 构建产物** 交叉分析 |

### 核心优势

- **多维浪费模型**：不只看 JS 体积，还覆盖缓存失效、重复依赖等非 bundle 浪费；
- **零业务侵入**：作为 Vite 插件接入，无需修改业务代码；
- **可执行建议**：每条 issue 附带 severity、开销估算、修复 suggestion；
- **Dev + Build 双模式**：开发时轻量预警，构建时完整报告；
- **TypeScript 友好**：完整类型导出，配置项有 IDE 提示；

---

## 功能一览

### 检测能力

| 类别 | 检测内容 | 典型场景 |
|---|---|---|
| **import-pattern** | lodash/moment/antd 全量导入、barrel 文件 | tree-shake 失效，体积虚高 |
| **dead-import** | 已 import 但未使用的本地模块（含页面/组件） | 路由注释了但 import 未删、组件引入未使用 |
| **unreachable-component** | 不在 module graph 中的页面/组件 | 遗留代码、已下线活动页 |
| **static-unused-js** | 过多 export、独立 async chunk 风险 | 工具库 export 膨胀、误 prefetch |
| **cache-miss** | 产物文件名缺少 content hash | 字体/图片回访重复下载 |
| **duplicate-dependency** | 同一 npm 包多版本共存 | 重复打包、缓存 key 失效 |

### 报告输出

构建完成后，在 `dist/resource-waste/`（可配置）生成：

| 文件 | 说明 |
|---|---|
| `report.json` | 机器可读，供 CI 脚本、自动化工具或内部平台读取 |
| `report.html` | 可视化报告，可直接浏览器打开 |

终端同时输出摘要与 Top 5 问题。

---

## 安装

```bash
npm install vite-plugin-resource-waste -D
# pnpm add vite-plugin-resource-waste -D
# yarn add vite-plugin-resource-waste -D
```
---

## 快速开始

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { resourceWaste } from 'vite-plugin-resource-waste'

export default defineConfig({
  plugins: [
    resourceWaste(),
  ],
})
```

执行构建：

```bash
npm run build
```

查看报告：

```
dist/resource-waste/report.html   # 可视化报告
dist/resource-waste/report.json     # JSON 数据
```

---

## 使用示例

### 基础用法（推荐默认值）

```ts
import { defineConfig } from 'vite'
import { resourceWaste } from 'vite-plugin-resource-waste'

export default defineConfig({
  plugins: [
    resourceWaste({
      htmlReport: true,       // 生成 HTML 报告
      wasteThresholdKb: 300,  // 浪费超过 300KB 时在终端提示
    }),
  ],
})
```

### CI 构建阈值拦截：浪费超标则构建失败

当项目在 GitHub Actions、GitLab CI 等平台自动构建时，可配置浪费超标直接失败，阻止合并不达标的代码：

```ts
resourceWaste({
  wasteThresholdKb: 200,
  failOnThreshold: true,  // 超过阈值则构建失败，CI 流水线中断
  silent: false,
})
```

### 按需开启/关闭检测项

```ts
resourceWaste({
  scanImportPatterns: true,   // 扫描 lodash 全量导入等
  scanUnusedImports: true,    // 扫描未使用的本地静态 import
  scanUnreachable: true,      // 扫描不可达页面/组件
  scanCacheStrategy: true,    // 扫描产物 cache 策略
  scanDuplicateDeps: true,    // 扫描重复依赖版本
})
```

### Monorepo / 自定义扫描范围

```ts
resourceWaste({
  root: 'packages/app/src',
  include: ['**/*.tsx'],
  exclude: [
    '**/*.spec.*',
    '**/__tests__/**',
    '**/stories/**',
  ],
  reportDir: 'resource-waste', // 相对 outDir
})
```

### 静默模式（仅写报告，不输出终端日志）

```ts
resourceWaste({
  silent: true,
  htmlReport: true,
})
```

---

## 配置项

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `root` | `string` | `'src'` | 源码根目录 |
| `reportDir` | `string` | `'resource-waste'` | 报告输出目录（相对 `outDir`） |
| `wasteThresholdKb` | `number` | `300` | 预估浪费阈值（KB），用于终端提示与 CI 拦截 |
| `failOnThreshold` | `boolean` | `false` | 超过阈值是否中断构建 |
| `htmlReport` | `boolean` | `true` | 是否生成 HTML 可视化报告 |
| `scanImportPatterns` | `boolean` | `true` | 是否扫描低效 import 模式 |
| `scanUnusedImports` | `boolean` | `true` | 是否扫描未使用的本地静态 import |
| `scanUnreachable` | `boolean` | `true` | 是否扫描不可达源文件/组件 |
| `scanCacheStrategy` | `boolean` | `true` | 是否分析产物缓存策略 |
| `scanDuplicateDeps` | `boolean` | `true` | 是否检测重复依赖版本 |
| `include` | `string[]` | `[]` | 额外 glob 包含模式 |
| `exclude` | `string[]` | 测试文件等 | 排除扫描的路径 |
| `silent` | `boolean` | `false` | 静默模式，不输出终端摘要 |

---

## 报告示例

### 终端输出

```text
[vite-plugin-resource-waste] Resource waste analysis complete

  Issues       : 6
  Waste (est.) : 142.5 KB transfer / 64.1 ms parse
  Threshold    : 300 KB

  Top issues:
    [HIGH] 全量/低效导入: lodash (src/main.ts)
    [HIGH] 产物文件名缺少 content hash (assets/fonts/main.woff2)
    [MEDIUM] 不可达源文件 (src/pages/legacy/Double11.ts)
    [MEDIUM] Barrel 文件可能导致 tree-shake 失效 (src/pages/index.ts)
```

### JSON 报告结构（节选）

`report.json` 可被 CI 脚本读取，例如在 PR 评论中自动贴出浪费摘要，或接入内部质量看板：

```json
{
  "summary": {
    "totalIssues": 6,
    "totalWasteTransferKb": 142.5,
    "totalParseMsEstimate": 64.1,
    "bySeverity": { "high": 2, "medium": 3, "low": 1 }
  },
  "issues": [
    {
      "category": "import-pattern",
      "severity": "high",
      "title": "全量/低效导入: lodash",
      "file": "src/main.ts",
      "suggestion": "改为 import debounce from 'lodash-es/debounce' 或按需导入",
      "cost": {
        "transferKb": 24,
        "parseMsEstimate": 10.8
      }
    }
  ]
}
```

---

## 开发模式

`vite dev` 启动后，插件会做**轻量静态分析**（无 bundle 数据），发现问题时在终端提示：

```text
[vite-plugin-resource-waste] Dev mode: found 3 potential resource waste issue(s).
Run "vite build" for full report.
```

Dev 报告写入：`node_modules/.cache/resource-waste/dev-report.json`

---

## 工作原理（简述）

```
vite build
  ├── buildStart      → glob 扫描 src 源文件
  ├── moduleParsed    → 构建 Module Graph（import 依赖关系）
  ├── generateBundle  → 收集 Rollup 产物（chunk + asset）
  └── closeBundle     → 运行分析器 → 生成报告
```

分析器并行执行：

1. **import-pattern-analyzer** — 正则 + 启发式检测低效导入
2. **unreachable-analyzer** — 对比源文件与 module graph 可达集
3. **cache-analyzer** — 检查产物文件名是否含 content hash
4. **duplicate-deps-analyzer** — 统计 bundle 中 npm 包版本
5. **unused-export 启发式** — export 过多且引用者极少

---

## 常见问题

**Q: 和 rollup-plugin-visualizer 有什么区别？**

visualizer 回答「bundle 长什么样」；本插件回答「**哪些资源白花了、浪费多少、怎么修**」。

**Q: 报告里的 KB/ms 是精确值吗？**

传输体积对已知模式（如 lodash 全量导入）有参考估算；解析耗时基于经验公式（~0.45ms/KB）。建议作为**优先级排序依据**，而非绝对性能指标。

**Q: 生产环境会有性能影响吗？**

不会。所有分析在**构建期**完成，不注入任何运行时代码到产物中。

---

