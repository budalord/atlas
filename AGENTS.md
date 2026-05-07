<!-- MIRROR target: .claude/skills/alts/SKILL.md. Canonical: AGENTS.md. 两份文件正文必须语义等价;若不一致,以 AGENTS.md 为准。修改任意一份时同步另一份。 -->

# Atlas Agent Instructions

Atlas/alts is an agent-native, local-first product specification system. These instructions apply when maintaining Atlas product specs, Intake outputs, `STATUS.md`, `meta.yml`, feature rows, or cross-product contracts. They do not apply to general application coding.

## Read First

Before making changes, read the smallest set of source-of-truth files needed for the task:

- Start with `README.md` and `docs/DATA-MODEL.md`.
- Before modifying a product, read `data/products/<id>/meta.yml` and `data/products/<id>/STATUS.md`.
- When shared APIs or cross-product dependencies are involved, read relevant files under `data/contracts/`.
- When parser behavior matters, treat `apps/api/src/services/markdownParser.ts` as the implementation source of truth. If documentation and code disagree, code wins.

## Schema Rules

- `STATUS.md` must keep the expected structure with all six sections in this order:
  1. frontmatter (with at least `last_updated`)
  2. `# 当前状态`
  3. `## 待办`
  4. `## 阻塞`
  5. `## 功能点`
  6. `## 流程图`
- The feature table under `## 功能点` must have exactly 6 columns: `ID | 描述 | 状态 | 优先级 | 接口 | 备注`.
- Do not use 4-column tables, omit columns, reorder columns, or add columns. The parser maps cells positionally, so malformed tables silently shift data into the wrong fields.
- Feature IDs must be sequential within a product. The prefix can be product-specific (e.g. `F1`, `FE01`), but it must stay consistent within the same product.
- Priority uses `P0/P1/P2/P3`.
- For uncertain facts, write `TODO`, `待确认`, or an explicit note. Do not invent business facts.
- `meta.yml` field values follow `docs/DATA-MODEL.md`. `status` is one of `in-progress / paused / live / archived`; `theme` is one of `seo / erp / miniapp / tool`.

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
- Discover inspects the source project read-only and produces factual observations (`DISCOVERY.md`) without modifying source project code.
- Interview asks only business/product questions that cannot be answered from code, captured in `INTERVIEW.md`, and waits for the user to answer.
- Finalize must leave these artifacts in place under `data/products/<id>/`: `STATUS.md` (full 6-section structure with the 6-column feature table and a Mermaid 流程图), an updated `meta.yml`, and `SUMMARY.md` (recording which fields were inferred from code, which were taken from user answers, and which remain uncertain).
- If the user confirms shared APIs, shared databases, or shared account systems, create contract drafts under `data/contracts/<provider>-<consumer>-<topic>.md`.
- Keep `DISCOVERY.md` and `INTERVIEW.md` as history; do not delete them.

### Product Status Maintenance

- Use this workflow for status updates, feature completion, feature additions, and `meta.yml` maintenance. Feature completion is part of this workflow, not a separate one.
- Make the smallest necessary edits to `data/products/<id>/STATUS.md` and, when needed, `meta.yml`.
- Preserve the `STATUS.md` section layout and the 6-column feature table schema. New rows must use the same 6 columns; priority uses `P0/P1/P2/P3`.
- Keep todos, blockers, summary text, and feature statuses aligned with the requested change.
- Update the `last_updated` field in `STATUS.md` frontmatter.

### Cross-product Contract Maintenance

- Add or update contracts only when a shared API or cross-product dependency is explicit. Single-product internal APIs do not get a contract.
- Store contracts as markdown files under `data/contracts/<provider>-<consumer>-<topic>.md`.
- Keep related product feature rows linked through the `备注` column when a feature depends on or exposes the contract.
- Contract status (`draft / agreed / deprecated`) is required; default to `draft` when not yet agreed.

## Do Not

- Do not casually modify the source project being recorded by Intake (the directory referenced by `source_path`).
- Do not modify Atlas application code under `apps/` or `packages/` unless the task explicitly requests it.
- Do not introduce databases, authentication, deployment config, health scoring, export systems, AI integrations, or graph features as part of spec maintenance.
- Do not write derived metrics (progress percentages, health scores, etc.) back into markdown/yaml source data; derivation belongs in the API/web layer.
- Do not perform unrelated refactors.
- Do not reorder unrelated documentation or "tidy up" unrelated formatting.
- Do not mark merely-planned features as `live` or `done`; use `planned` or a note.

## Self-check

- When modifying `AGENTS.md` or `.claude/skills/alts/SKILL.md`, manually diff the two body sections and keep their rules semantically equivalent. v1 has no automated check; this is enforced by the editor.
- Confirm the 6-column feature table schema is preserved.
- Confirm feature ID continuity and prefix consistency within the product.
- Confirm Intake stage names and internal values still match `packages/shared/src/types.ts`.
- After a Finalize run, confirm `data/products/<id>/` contains all three required artifacts: `STATUS.md`, `meta.yml`, and `SUMMARY.md`.
- Confirm `STATUS.md` frontmatter `last_updated` is updated when the file changed.
- If a task asks to "also" refactor parser or application code during spec maintenance, treat that as out of scope unless the user explicitly authorizes a separate implementation task.
- If an existing feature table has only 4 columns or malformed columns, fix it to the 6-column schema before relying on parsed feature data.
