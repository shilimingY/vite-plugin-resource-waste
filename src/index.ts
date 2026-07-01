/**
 * 包入口：对外暴露插件工厂函数与类型定义
 */
export { resourceWaste, default } from './plugin'
export type {
  ResourceWastePluginOptions,
  ResourceWasteReport,
  ResourceIssue,
  ResourceWasteSummary,
  IssueCategory,
  IssueSeverity,
} from './types'
