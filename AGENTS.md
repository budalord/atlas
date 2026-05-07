<!-- MIRROR target: .claude/skills/alts/SKILL.md. Canonical: AGENTS.md. 两份文件正文必须语义等价;若不一致,以 AGENTS.md 为准。修改任意一份时同步另一份。 -->

# Atlas Agent Instructions

Atlas/alts is an agent-native, local-first product specification system. These instructions apply when maintaining Atlas product specs, Intake outputs, `STATUS.md`, `meta.yml`, feature rows, or cross-product contracts.

## Read First

Before making changes, read the smallest set of source-of-truth files needed for the task:

- Start with `README.md` and `docs/DATA-MODEL.md`.
- Before modifying a product, read `data/products/<id>/meta.yml` and `data/products/<id>/STATUS.md`.
- When shared APIs or cross-product dependencies are involved, read relevant files under `data/contracts/`.
- When parser behavior matters, treat `apps/api/src/services/markdownParser.ts` as the implementation source of truth.

## Schema Rules

- `STATUS.md` must keep the expected structure: frontmatter, `# 当前状态`, `## 待办`, `## 阻塞`, `## 功能点`, and `## 流程图`.
- The feature table under `## 功能点` must have exactly 6 columns: `ID | 描述 | 状态 | 优先级 | 接口 | 备注`.
- Do not use 4-column tables, omit columns, or reorder columns. The parser maps cells positionally, so malformed tables can silently shift data into the wrong fields.
- Feature IDs must be sequential within a product. The prefix can be product-specific, but it must stay consistent within the same product.
- For uncertain facts, write `TODO`, `待确认`, or an explicit note. Do not invent business facts.

## Intake Stage Mapping

Use the public Chinese/English stage names in user-facing docs and UI text. Use internal stage values only when working with API/types.

| Public stage | Internal values |
| --- | --- |
| 发现 (Discover) | `stage1` |
| 访谈 (Interview) | `stage2`, `stage2-pending` |
| 沉淀 (Finalize) | `stage3`, `finalized`, `done` |

The type source of truth is `packages/shared/src/types.ts`.

## Workflows

### New Product Intake

- Follow the three-stage Intake flow: 发现 (Discover), 访谈 (Interview), 沉淀 (Finalize).
- Discover should inspect the source project and produce factual observations without changing source project code.
- Interview should ask only business/product questions that cannot be answered from code.
- Finalize must leave these artifacts in place: `STATUS.md`, an updated `meta.yml`, and `SUMMARY.md`.
- If the user confirms shared APIs, create contract drafts under `data/contracts/<provider>-<consumer>-<topic>.md`.

### Product Status Maintenance

- Use this workflow for status updates, feature completion, feature additions, and `meta.yml` maintenance.
- Make the smallest necessary edits to `data/products/<id>/STATUS.md` and, when needed, `meta.yml`.
- Preserve the `STATUS.md` section layout and the 6-column feature table schema.
- Keep todos, blockers, summary text, and feature statuses aligned with the requested change.

### Cross-product Contract Maintenance

- Add or update contracts only when a shared API or cross-product dependency is explicit.
- Store contracts as markdown files under `data/contracts/<provider>-<consumer>-<topic>.md`.
- Keep related product feature rows linked through the `备注` column when a feature depends on or exposes the contract.

## Do Not

- Do not casually modify the source project being recorded by Intake.
- Do not introduce databases, authentication, deployment config, health scoring, export systems, or graph features as part of spec maintenance.
- Do not write derived metrics back into markdown/yaml source data.
- Do not perform unrelated refactors.
- Do not reorder unrelated documentation.

## Self-check

- When modifying `AGENTS.md` or `.claude/skills/alts/SKILL.md`, manually diff the two body sections and keep their rules semantically equivalent.
- Confirm the 6-column feature table schema is preserved.
- Confirm feature ID continuity and prefix consistency within the product.
- Confirm Intake stage names and internal values still match `packages/shared/src/types.ts`.
- If a task asks to "also" refactor parser or application code during spec maintenance, treat that as out of scope unless the user explicitly authorizes a separate implementation task.
- If an existing feature table has only 4 columns or malformed columns, fix it to the 6-column schema before relying on parsed feature data.
