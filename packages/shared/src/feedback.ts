/**
 * 反馈池(Feedback Pool)— 一条 feature/entity 的"等待 Agent 处理"留言队列。
 *
 * 设计精简后(批次 1'):
 *   - 反馈池无状态机:只有"存在" vs "不存在"两种事实
 *   - 反馈池有内容 = 等待 Agent 处理;为空 = 已处理
 *   - feature.md / entity.md frontmatter 上的 needs_revision: true 是"用户加过反馈"的快照
 *     标记,由 Atlas 在 POST 时自动写、在最后一条删除时自动抹掉。Agent 自己 revise 完毕
 *     可以直接把 needs_revision 字段删掉,并清空 ## 反馈池 段。
 *   - 不再区分 proposal / acceptance / note;不再有 pending/in-review/accepted/rejected/rework;
 *     不再有 agent / user source;不再有 acceptance_scope / decision_note / decided_at。
 */

export interface Feedback {
  /**
   * 行内唯一 id;格式 fb-<YYYYMMDD>-<6 位 base36 随机>,例如 fb-20260515-a1b2c3。
   * 由后端 POST /api/products/:id/feedback 时生成并写入 markdown。
   */
  id: string;
  /** 创建日期 YYYY-MM-DD */
  date: string;
  /** 正文(markdown 片段,允许多行) */
  content: string;
}

/**
 * 全局需求池条目的范围 — 决定该条会被哪个 tab 的 revise prompt 消费,
 * 也决定它写在 GLOBAL-FEEDBACK.md 的哪个 section 下。
 */
export type GlobalFeedbackScope = "feature" | "entity" | "prototype";

/**
 * 全局需求池条目 — 装"新增/删除一个 feature 或 module"这类无法挂在已有对象上的反馈。
 * id 形如 gfb-<YYYYMMDD>-<6 位 base36>,与对象级 fb- 前缀区分。
 */
export interface GlobalFeedback {
  id: string;
  date: string;
  scope: GlobalFeedbackScope;
  content: string;
}

/**
 * GLOBAL-FEEDBACK.md 解析出的三段内容。
 * 三段独立解析,任一段 yaml 损坏不影响其他段。
 */
export interface GlobalFeedbackData {
  feature: GlobalFeedback[];
  entity: GlobalFeedback[];
  prototype: GlobalFeedback[];
}
