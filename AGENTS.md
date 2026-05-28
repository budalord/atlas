# Atlas Agent Instructions

Atlas/alts is an agent-native, local-first product specification system. These instructions apply when maintaining Atlas product specs, Intake outputs, `STATUS.md`, `meta.yml`, feature rows, or cross-product contracts. They do not apply to general application coding.

## Read First

Before changes, read the smallest set of source-of-truth files needed:

- `README.md` + `docs/DATA-MODEL.md` for product/data model basics.
- Before modifying a product: `data/products/<id>/meta.yml` + `data/products/<id>/STATUS.md`.
- Cross-product / shared APIs: files under `data/contracts/`.
- Schema details for each markdown type are in `docs/<scope>-contract.md` (see "Schema sources" below). When docs and code disagree, **code wins** — parser files in `apps/api/src/services/` are the implementation source of truth.

## Schema sources

Don't memorize schemas — read the contract file for the scope you're touching:

| Scope | Contract |
|---|---|
| feature.md | `docs/feature-source-contract.md` |
| entity.md | `docs/entity-contract.md` |
| usecase.md | `docs/usecase-contract.md` |
| screen.md | `docs/screen-contract.md` |
| actor.md | `docs/actor-contract.md` |
| capability.md | `docs/capability-contract.md` |
| decisions / seams / warnings / entities-ownership | `docs/<topic>-contract.md` |

Hard rules common to all (apply even if the contract file doesn't repeat them):

- frontmatter must be valid YAML; missing required fields invalidates parsing
- `STATUS.md` 功能点 table is **exactly 6 columns**: `ID | 描述 | 状态 | 优先级 | 接口 | 备注` — never 4 columns, never reorder
- Feature IDs sequential within a product; prefix product-specific but consistent
- Priority is `P0/P1/P2/P3`
- `meta.yml.status` is one of `discovering / planning / in-progress / paused / live / archived`
- `meta.yml.theme` is one of `seo / erp / miniapp / tool`
- For uncertain facts: write `TODO` / `待确认` / explicit note. **Do not invent business facts.**

## Module / Feature / Entity Tree

```
data/products/<id>/
  meta.yml
  STATUS.md
  GLOBAL-FEEDBACK.md         (optional, see "全局需求池")
  CONVENTIONS.md             (optional, L0 规范)
  modules/<moduleId>/
    MODULE.md                (optional)
    features/<featureId>.md
    usecases/<usecaseId>.md
    screens/<screenId>.md
    entities/<entityId>.md   (module-scoped entities)
  entities/<entityId>.md     (cross-module shared entities)
  derived/entities/          (Path C 派生实体, agent 通常不直接动)
```

Legacy products only have `STATUS.md` 6-column table, no `modules/` tree. Atlas UI shows a placeholder for these.

## 反馈池 (对象级) — agent 处理义务

Each feature.md / entity.md / usecase.md / screen.md ends with a `## 反馈池` YAML block. Schema in `docs/<scope>-contract.md`.

When invoked via **revise prompt**, for every feature/entity touched:

1. Read every `## 反馈池` entry of the target.
2. Modify the file body (description / fields / relations).
3. **Must**: remove `needs_revision` from frontmatter (or set to false).
4. **Must**: empty `## 反馈池` to `[]`.
5. **Must**: append `YYYY-MM-DD: 基于 N 条反馈修订 - 简短说明` to `## 修订记录` (create section if missing).
6. Unaccepted feedback: explain reason in diff plan, **still clear it** (otherwise `needs_revision` stays and the next revise round repeats).

## 全局需求池

File: `data/products/<id>/GLOBAL-FEEDBACK.md`. Three independent yaml sections by scope (`feature` / `entity` / `prototype`). Empty section is `[]`. Full schema in `docs/feature-source-contract.md`.

Agent obligation: process entries → **directly edit GLOBAL-FEEDBACK.md** to delete the processed `- id: gfb-xxx ... content: ...` blocks. Update frontmatter `last_updated` to today. Even unaccepted entries are deleted (explain reason in diff plan). Otherwise the next revise repeats them.

> Round 3 early behavior asked agent to "tell user which ids to delete"; 5' patch reversed that — agent now cleans up directly.

## L0 规范 (CONVENTIONS.md)

File: `data/products/<id>/CONVENTIONS.md`. Product-level hard constraints (naming / required fields / forbidden patterns / decision snapshots). No object-level feedback pool, no revise prompt — Round 3 deliberately routes L0 through generate-mode only.

Frontmatter: `spec_level: 0` + `version` (auto-increment) + `last_updated`. Not strictly validated.

When generating CONVENTIONS.md: prefer 增量补全 over 整体覆盖.

## Revise / Generate Prompt — two modes

Atlas exposes two prompt builders per scope:

| Mode | Input | Output | Trigger |
|---|---|---|---|
| **revise** | needs_revision=true objects + global feedback pool | Modify existing files | UI batch button (v0.2b1+) or copy-prompt button (v0.2a fallback) |
| **generate** | Product description + existing objects (context only) | New files / overwrite | UI generate button (empty state) |

Identify mode from prompt title:
- "# Atlas {scope}修订任务" → **revise**: diff existing files, clear feedback pool traces (see obligations above)
- "# Atlas {scope}生成任务" → **generate**: output generation plan first, then write new files. **Do not** set `needs_revision` on newly created files.

Both modes can target the same file at different times.

**v0.2b1 batch mode**: agent runs non-interactively in `codex exec -s workspace-write`. The preamble (`V02B1_BATCH_PREAMBLE` in `codexRunner.ts`) overrides any "wait for user confirmation" instructions in builder prompts. Edit/Write directly. Atlas snapshots before/after and surfaces changeset for review.

## Intake Stage Mapping

| Public stage | Internal values |
|---|---|
| 发现 (Discover) | `stage1` |
| 访谈 (Interview) | `stage2`, `stage2-pending` |
| 沉淀 (Finalize) | `stage3`, `finalized`, `done` |

Type source of truth: `packages/shared/src/types.ts`. `meta.yml` has **no** `intake_substage` field (Round 3 removed it).

## Workflows

### New Product Intake

Three-stage: 发现 / 访谈 / 沉淀. Each writes specific artifacts:
- Discover → read-only inspection of `source_path`, produces `DISCOVERY.md`
- Interview → business-only questions agent can't answer from code, produces `INTERVIEW.md`, **waits for user**
- Finalize → produces `STATUS.md` (6-section + 6-column table + Mermaid 流程图), updated `meta.yml`, `SUMMARY.md`. Cross-product shared APIs → create `data/contracts/<provider>-<consumer>-<topic>.md` drafts.

Keep `DISCOVERY.md` / `INTERVIEW.md` as history; do not delete.

### Product Status Maintenance

Smallest necessary edits to `STATUS.md` (and `meta.yml` if needed). Preserve 6-section layout and 6-column table. Update `last_updated` when changed.

### Feedback Revise

Read all object-level `## 反馈池` + matching-scope `GLOBAL-FEEDBACK.md` entries. v0.2b1 batch: write files directly (preamble overrides). v0.2a fallback: output diff plan + wait for user confirmation. See "反馈池 agent 处理义务" + "全局需求池 agent 处理义务" above for cleanup obligations.

### Feature / Entity / Conventions Generate

Output generation plan first (v0.2a) or write directly (v0.2b1 batch preamble overrides). New files obey contracts in `docs/`. **Do not** set `needs_revision` on new files. CONVENTIONS.md: increment `version`, 增量补全 not 整体覆盖.

### Cross-product Contract Maintenance

Only when explicit shared API / cross-product dependency. Store as `data/contracts/<provider>-<consumer>-<topic>.md`. Status: `draft / agreed / deprecated`, default `draft`. Link relevant feature rows via 备注 column.

## Do Not

- Don't modify the source project referenced by `source_path` casually (Intake reads it; only specific Intake stages may write).
- Don't modify Atlas application code under `apps/` or `packages/` unless explicitly asked.
- Don't introduce databases, auth, deployment config, health scoring, export systems, AI integrations, or graph features as part of spec maintenance.
- Don't write derived metrics (progress %, health scores) into markdown/yaml; derivation belongs in API/web layer.
- Don't reorder unrelated documentation or "tidy up" unrelated formatting.
- Don't mark planned features as `live` / `done`; use `planned` or a note.
- Don't write `needs_revision: true` on freshly created (generate-mode) files.
- Don't bring back `intake_substage` or the three-stage 立项 UI (Round 3 deliberately removed).
- Don't restore TBD / 决策 aggregate views (Round 3 removed; data preserved in files).
- Don't tell user to "delete these GLOBAL-FEEDBACK ids" — directly edit the file (5' patch policy).

## Self-check

- Confirm 6-column feature table schema preserved.
- Confirm feature ID continuity + prefix consistency within product.
- Confirm Intake stage names + internal values still match `packages/shared/src/types.ts`.
- After Finalize: `data/products/<id>/` contains `STATUS.md` + `meta.yml` + `SUMMARY.md`.
- Confirm `last_updated` updated when file changed.
- After revise: each touched file has `needs_revision` removed, `## 反馈池` empty, `## 修订记录` appended.
- After generate: new files do **not** carry `needs_revision: true`.
- If existing feature table has 4 columns / malformed: fix to 6-column before relying on parsed data.
- Out of scope: parser/app refactors during spec maintenance — separate implementation task.
