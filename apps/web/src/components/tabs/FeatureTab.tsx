import { useEffect, useMemo, useRef, useState } from "react";
import { Markmap } from "markmap-view";
import type { IPureNode } from "markmap-common";
import { useDataChange } from "../../lib/useDataChange";
import type { ApiEnvelope, FeaturePointPreview, ModuleWithFeatures, RolesRegistry } from "../../types";
import { FeatureHoverCard } from "../FeatureHoverCard";
import { FeatureModal } from "../FeatureModal";
import { FeatureOverlapBanner } from "../FeatureOverlapBanner";
import { FlowchartView } from "../FlowchartView";
import { GlobalFeedbackPanel } from "../GlobalFeedbackPanel";
import { PromptModalDialog, type PromptMode } from "../PromptModalDialog";

/** 7 天内创建且未审阅 → 🆕 徽章 */
const NEW_BADGE_DAYS = 7;
function isRecentlyCreated(createdAt: string): boolean {
  if (!createdAt) return false;
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return false;
  return Date.now() - created < NEW_BADGE_DAYS * 86400 * 1000;
}

interface FeatureTabProps {
  productId: string;
  /** 老接口保留:批次 2' markmap 不会主动调,但 ProductDetail 仍传 */
  onOpenFeature?: (moduleId: string, featureId: string) => void;
  readOnly?: boolean;
}

interface FeatureRef {
  moduleId: string;
  featureId: string;
}

interface HoveredFeature {
  ref: FeatureRef;
  preview: FeaturePointPreview;
  anchor: { x: number; y: number };
}

/**
 * 批次 2' · markmap 横向思维导图视图。
 *
 *   - 数据源:GET /api/products/:id/modules-with-features
 *   - 渲染:markmap-view 的 Markmap.create() 接 IPureNode 树
 *   - 节点点击:监听 SVG 容器的 click,冒泡到 g.markmap-node,读 d3 datum 上挂的
 *     payload.featureRef,弹 FeatureModal
 *   - needs_revision=true 的功能点叶节点 content 末尾拼 " ⚠"
 *   - SSE data-change 时调 Markmap.setData() 增量更新(保留缩放/平移状态)
 */
type ViewMode = "markmap" | "flowchart";

export function FeatureTab({ productId, readOnly = false }: FeatureTabProps) {
  const [data, setData] = useState<ModuleWithFeatures[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [productName, setProductName] = useState<string>("");
  const [openFeature, setOpenFeature] = useState<FeatureRef | null>(null);
  const [rolesRegistry, setRolesRegistry] = useState<RolesRegistry | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("markmap");
  const [hovered, setHovered] = useState<HoveredFeature | null>(null);
  // hover 关闭定时器:鼠标离开节点 → 启动 → 移入卡片可取消
  const hoverCloseTimerRef = useRef<number | null>(null);
  // 让事件处理器始终拿到最新 data(避免闭包过期)
  const dataRef = useRef<ModuleWithFeatures[] | null>(null);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const [promptOpen, setPromptOpen] = useState<PromptMode | null>(null);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const mmRef = useRef<Markmap | null>(null);
  /**
   * 记录 mmRef 当前绑定的 SVG DOM 元素。当 React 重新挂载 SVG(产品切换 / 走过
   * "无 modules 树"占位再回来)时,这里的引用与 svgRef.current 不一致,需要先 destroy
   * 旧实例再 create 新实例,避免 d3 zoom 在脱离 DOM 的 SVG 上读取 SVGLength 抛错。
   */
  const mmSvgRef = useRef<SVGSVGElement | null>(null);

  const loadList = async () => {
    try {
      const [modsRes, prodRes] = await Promise.all([
        fetch(`/api/products/${productId}/modules-with-features`),
        fetch(`/api/products/${productId}`)
      ]);
      if (!modsRes.ok) throw new Error(`${modsRes.status}`);
      const modsJson = (await modsRes.json()) as ApiEnvelope<ModuleWithFeatures[]>;
      setData(modsJson.data);
      if (prodRes.ok) {
        const prodJson = (await prodRes.json()) as ApiEnvelope<{ meta: { name: string } }>;
        setProductName(prodJson.data.meta.name);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    }
  };

  useEffect(() => {
    setData(null);
    setOpenFeature(null);
    void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  useDataChange(() => {
    void loadList();
    void loadRoles();
  });

  async function loadRoles() {
    try {
      const res = await fetch("/api/roles");
      if (!res.ok) return;
      const json = (await res.json()) as ApiEnvelope<RolesRegistry>;
      setRolesRegistry(json.data);
    } catch {
      // 角色注册表加载失败时 markmap 仅缺少角色名后缀,不阻塞主图
    }
  }

  useEffect(() => {
    void loadRoles();
  }, []);

  const roleIdToName = useMemo(() => {
    const map = new Map<string, string>();
    rolesRegistry?.roles.forEach((r) => map.set(r.id, r.name));
    return map;
  }, [rolesRegistry]);

  const tree = useMemo<IPureNode | null>(() => {
    if (!data) return null;
    if (data.length === 0) return null;
    return buildTree(productName || productId, data, roleIdToName);
  }, [data, productId, productName, roleIdToName]);

  // 初始化 / 更新 Markmap 实例。
  // SVG 容器始终挂载(切流程图视图用 CSS display:none),所以 Markmap 实例 + d3 状态
  // 跨视图切换保留,本 effect 仅在 tree 变时增量 setData。
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    if (!tree) {
      if (mmRef.current) {
        mmRef.current.destroy();
        mmRef.current = null;
        mmSvgRef.current = null;
      }
      return;
    }
    // SVG 元素换了(产品切换 / 走过 fallback 再回来 / 流程图视图切回)→ destroy 旧实例再 create
    if (mmRef.current && mmSvgRef.current !== svg) {
      mmRef.current.destroy();
      mmRef.current = null;
      mmSvgRef.current = null;
    }
    if (!mmRef.current) {
      mmRef.current = Markmap.create(
        svg,
        {
          autoFit: true,
          duration: 300,
          initialExpandLevel: 2,
          pan: false,
          paddingX: 8,
          spacingHorizontal: 80,
          spacingVertical: 8,
          maxWidth: 320
        },
        tree
      );
      mmSvgRef.current = svg;
    } else {
      void mmRef.current.setData(tree);
      void mmRef.current.fit();
    }
  }, [tree]);

  // 卸载时清理
  useEffect(() => {
    return () => {
      if (mmRef.current) {
        mmRef.current.destroy();
        mmRef.current = null;
        mmSvgRef.current = null;
      }
    };
  }, []);

  // SVG 容器的 click + hover 事件代理:
  //   click → 打开 FeatureModal(看技术全貌)
  //   mouseenter on g.markmap-node → 显示 FeatureHoverCard(决策者视角 + 快速操作)
  //   mouseleave on g.markmap-node → 启动延时关闭(300ms),移入卡片可取消
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const findFeatureRefAt = (target: Element | null): FeatureRef | null => {
      let el = target;
      while (el && el !== svg) {
        if (el.classList && el.classList.contains("markmap-node")) break;
        el = el.parentElement;
      }
      if (!el || el === svg) return null;
      const datum = (el as unknown as { __data__?: { payload?: { featureRef?: FeatureRef } } })
        .__data__;
      return datum?.payload?.featureRef ?? null;
    };

    const lookupPreview = (ref: FeatureRef): FeaturePointPreview | null => {
      const mods = dataRef.current;
      if (!mods) return null;
      const mw = mods.find((m) => m.module.name === ref.moduleId);
      return mw?.features.find((f) => f.id === ref.featureId) ?? null;
    };

    const cancelHoverClose = () => {
      if (hoverCloseTimerRef.current !== null) {
        window.clearTimeout(hoverCloseTimerRef.current);
        hoverCloseTimerRef.current = null;
      }
    };

    const onClick = (e: MouseEvent) => {
      // markmap-view circle 是折叠/展开控件,放过
      const target = e.target as Element;
      if (target && target.tagName === "circle") return;
      const ref = findFeatureRefAt(target);
      if (ref) {
        cancelHoverClose();
        setHovered(null);
        setOpenFeature(ref);
      }
    };

    const onMouseOver = (e: MouseEvent) => {
      const target = e.target as Element;
      if (target && target.tagName === "circle") return;
      const ref = findFeatureRefAt(target);
      if (!ref) return;
      const preview = lookupPreview(ref);
      if (!preview) return;
      cancelHoverClose();
      setHovered({ ref, preview, anchor: { x: e.clientX, y: e.clientY } });
    };

    const onMouseOut = (e: MouseEvent) => {
      const target = e.target as Element;
      if (target && target.tagName === "circle") return;
      const ref = findFeatureRefAt(target);
      if (!ref) return;
      // 启动延时关闭;若鼠标移入卡片,卡片自己会调 onMouseEnter 取消该定时器
      cancelHoverClose();
      hoverCloseTimerRef.current = window.setTimeout(() => {
        setHovered(null);
        hoverCloseTimerRef.current = null;
      }, 300);
    };

    svg.addEventListener("click", onClick);
    svg.addEventListener("mouseover", onMouseOver);
    svg.addEventListener("mouseout", onMouseOut);
    return () => {
      svg.removeEventListener("click", onClick);
      svg.removeEventListener("mouseover", onMouseOver);
      svg.removeEventListener("mouseout", onMouseOut);
      cancelHoverClose();
    };
  }, [tree]);

  if (error) {
    return <div className="p-5 text-sm text-rose-700">{error}</div>;
  }
  if (data === null) {
    return <div className="p-5 text-xs text-slate-500">加载中...</div>;
  }
  // 无 modules 树:可能是新建产品(给 generate 入口),也可能是老 STATUS.md 产品(只提示)
  if (data.length === 0) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-4 text-slate-500">
        <div className="text-sm">该产品没有模块/功能点树</div>
        <div className="max-w-md text-center text-xs leading-5 text-slate-400">
          老结构产品使用 STATUS.md 6 列表,请在「概览」tab 查看。
          <br />
          新产品请点下方按钮拿到 prompt,丢给 Claude Code 让大 Agent 生成 modules + features。
        </div>
        {!readOnly ? (
          <button
            className="rounded-lg border-2 border-slate-900 bg-white px-5 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-900 hover:text-white"
            onClick={() => setPromptOpen("generate")}
            type="button"
          >
            📋 大 Agent · 生成功能点骨架
          </button>
        ) : null}
        {promptOpen ? (
          <PromptModalDialog
            mode={promptOpen}
            onClose={() => setPromptOpen(null)}
            productId={productId}
            scope="feature"
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-140px)] flex-col">
      {/* 视图切换 — 功能点视图(markmap) / 流程图视图(derived,只读) */}
      <div className="flex items-center gap-1 border-b border-slate-200 bg-slate-50 px-5 py-2 text-[12px]">
        <ViewToggleButton
          active={viewMode === "markmap"}
          onClick={() => setViewMode("markmap")}
        >
          功能点视图
        </ViewToggleButton>
        <ViewToggleButton
          active={viewMode === "flowchart"}
          onClick={() => setViewMode("flowchart")}
        >
          流程图视图
          <span className="ml-1 rounded bg-slate-200 px-1 py-0.5 text-[10px] font-normal text-slate-600">
            derived
          </span>
        </ViewToggleButton>
      </div>

      {/* markmap 区始终挂载,切流程图时用 display:none 隐藏 —— 避免 React 卸载 SVG
          导致 d3 zoom 在脱离 DOM 的 SVG 上读 SVGLength 抛错 + Markmap 实例需重建。
          切回后 SVG 元素是同一个,Markmap 实例 + d3 状态都保留,布局立即可见。 */}
      <div className={`flex min-h-0 flex-1 flex-col ${viewMode === "markmap" ? "" : "hidden"}`}>
        <FeatureOverlapBanner productId={productId} readOnly={readOnly} />
        <GlobalFeedbackPanel productId={productId} scope="feature" />
        <div className="px-5 pt-3 pb-2 text-[11px] text-slate-500">
          <span className="font-medium text-slate-700">{data.length}</span> 个模块 ·{" "}
          <span className="font-medium text-slate-700">
            {data.reduce((acc, m) => acc + m.features.length, 0)}
          </span>{" "}
          个功能点 · 悬停叶节点看决策者视角 + 快速投反馈 · 点击看完整详情 ·{" "}
          <span title="7 天内新建未审">🆕新增</span>{" "}
          <span title="决策者已标已审">✅已审</span>{" "}
          <span title="反馈池待 Agent 处理">💬反馈</span>{" "}
          <span title="frontmatter needs_revision=true">⚠待 Agent</span>
        </div>
        <div
          className="relative flex-1 overflow-hidden border-t border-slate-200 bg-slate-50"
          onWheel={(e) => {
            // 阻止滚轮事件冒泡到 document,防止整个 Atlas 页面跟着滚
            e.stopPropagation();
          }}
        >
          <svg
            ref={svgRef}
            className="h-full w-full cursor-pointer"
            style={{ touchAction: "none" }}
          />
          <button
            className="absolute bottom-4 right-4 rounded-full bg-slate-900 px-4 py-2 text-xs font-medium text-white shadow-lg hover:bg-slate-800"
            onClick={() => setPromptOpen("revise")}
            title="把 needs_revision=true 的 feature 反馈 + 全局需求 拼成 prompt 给 Claude Code 跑"
            type="button"
          >
            📋 复制全局 revise prompt
          </button>
        </div>
      </div>
      {viewMode === "flowchart" ? (
        <FlowchartView
          productId={productId}
          onOpenFeature={(moduleId, featureId) =>
            setOpenFeature({ moduleId, featureId })
          }
        />
      ) : null}

      {/* hover card 仅在 markmap 视图显示;开了 FeatureModal 就不再叠浮卡(避免视觉打架) */}
      {viewMode === "markmap" && hovered && !openFeature ? (
        <FeatureHoverCard
          productId={productId}
          moduleId={hovered.ref.moduleId}
          preview={hovered.preview}
          anchor={hovered.anchor}
          onMouseEnter={() => {
            if (hoverCloseTimerRef.current !== null) {
              window.clearTimeout(hoverCloseTimerRef.current);
              hoverCloseTimerRef.current = null;
            }
          }}
          onMouseLeave={() => {
            setHovered(null);
          }}
          onChanged={() => {
            void loadList();
            // 重新拉数据后,先关掉浮卡 — 新的 preview 会在用户再 hover 时拿到
            setHovered(null);
          }}
          onOpenDetail={() => {
            setHovered(null);
            setOpenFeature(hovered.ref);
          }}
        />
      ) : null}

      {openFeature ? (
        <FeatureModal
          featureId={openFeature.featureId}
          moduleId={openFeature.moduleId}
          onChanged={() => {
            void loadList();
          }}
          onClose={() => setOpenFeature(null)}
          productId={productId}
          readOnly={readOnly}
        />
      ) : null}
      {promptOpen ? (
        <PromptModalDialog
          mode={promptOpen}
          onClose={() => setPromptOpen(null)}
          productId={productId}
          scope="feature"
        />
      ) : null}
    </div>
  );
}

function ViewToggleButton({
  active,
  onClick,
  children
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`rounded px-3 py-1 text-[12px] font-medium ${
        active
          ? "bg-slate-900 text-white"
          : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** 转义最常见的几个 HTML 特殊字符,避免节点 content 串入 HTML。 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 把 modules+features 编排成 markmap IPureNode 根节点。
 *
 * 结构:
 *   root(产品名)
 *   └─ 模块(M 标签 + 标题)
 *      └─ 功能点(name)— 若 needs_revision 末尾拼 ⚠
 *
 * 每个 feature 节点挂 payload.featureRef = {moduleId, featureId},点击时反查。
 */
/**
 * 三层架构 markmap 树构建:
 *   root (产品名)
 *   └─ 业务方向 (module · 含 role 后缀)
 *      └─ 管理模块 (group · 来自 MODULE.md frontmatter.groups + 兜底"未分组")
 *         └─ 功能点 (feature · 含 role/warn 后缀)
 *
 * 优雅退化: 若一个 module 下所有 feature 都没有 module_group 且 MODULE.md 没声明 groups,
 * 则跳过中间层,直接 module → features(避免出现空的"未分组"占位节点)。
 */
function buildTree(
  productName: string,
  modules: ModuleWithFeatures[],
  roleIdToName: Map<string, string>
): IPureNode {
  return {
    content: escapeHtml(productName),
    children: modules.map((mw) => buildModuleNode(mw, roleIdToName))
  };
}

function buildModuleNode(
  mw: ModuleWithFeatures,
  roleIdToName: Map<string, string>
): IPureNode {
  const modLabel = `${mw.module.title || mw.module.name}${
    mw.module.role ? ` · ${mw.module.role}` : ""
  }`;

  // 把 features 按 module_group 分桶。group id → { name, features[] }
  // group 顺序:先用 MODULE.md 声明顺序,再加未声明的 group(按出现顺序),最后"未分组"。
  const declaredGroups = mw.module.groups ?? [];
  const groupNameById = new Map<string, string>();
  declaredGroups.forEach((g) => groupNameById.set(g.id, g.name));

  const groupOrder: string[] = declaredGroups.map((g) => g.id);
  const bucket = new Map<string, typeof mw.features>();
  declaredGroups.forEach((g) => bucket.set(g.id, []));
  const UNGROUPED = "__ungrouped__";

  for (const f of mw.features) {
    const gid = f.module_group?.trim();
    const key = gid && gid.length > 0 ? gid : UNGROUPED;
    if (!bucket.has(key)) {
      bucket.set(key, []);
      if (key !== UNGROUPED) groupOrder.push(key);
    }
    bucket.get(key)!.push(f);
  }
  if (bucket.has(UNGROUPED)) groupOrder.push(UNGROUPED);

  // 优雅退化: 没有任何 group 被实际使用 → 直接 module → features
  const usedGroups = groupOrder.filter((id) => (bucket.get(id) ?? []).length > 0);
  const onlyUngrouped =
    usedGroups.length === 1 && usedGroups[0] === UNGROUPED && declaredGroups.length === 0;
  if (onlyUngrouped) {
    return {
      content: escapeHtml(modLabel),
      children: mw.features.map((f) => buildFeatureNode(f, mw.module.name, roleIdToName))
    };
  }

  // 正常 3 层渲染
  return {
    content: escapeHtml(modLabel),
    children: usedGroups.map((gid) => {
      const features = bucket.get(gid) ?? [];
      const groupLabel =
        gid === UNGROUPED
          ? "未分组"
          : groupNameById.get(gid) ?? `${gid} ⚠`; // ⚠ 标记 feature 引用了 MODULE.md 未声明的 group
      return {
        content:
          `<span style="font-weight:600">${escapeHtml(groupLabel)}</span>` +
          ` <span style="color:#94a3b8;font-size:0.85em">(${features.length})</span>`,
        children: features.map((f) => buildFeatureNode(f, mw.module.name, roleIdToName))
      };
    })
  };
}

function buildFeatureNode(
  f: ModuleWithFeatures["features"][number],
  moduleId: string,
  roleIdToName: Map<string, string>
): IPureNode {
  // 状态徽章拼接(顺序固定:🆕 / ✅ / 💬N / ⚠)
  const badges: string[] = [];
  const isNew = !f.reviewed_at && isRecentlyCreated(f.created_at);
  if (isNew) {
    badges.push(`<span style="color:#0ea5e9;font-weight:600" title="7 天内新建,尚未审阅">🆕</span>`);
  }
  if (f.reviewed_at) {
    badges.push(
      `<span style="color:#059669;font-weight:600" title="决策者已审 · ${escapeHtml(f.reviewed_at)}">✅</span>`
    );
  }
  if (f.feedbackCount > 0) {
    badges.push(
      `<span style="color:#d97706;font-weight:600" title="${f.feedbackCount} 条反馈待 Agent 处理">💬${f.feedbackCount}</span>`
    );
  }
  if (f.needs_revision) {
    badges.push(
      `<span style="color:#dc2626;font-weight:600" title="frontmatter needs_revision=true · 等 Agent 重做">⚠</span>`
    );
  }
  const badgeSuffix = badges.length > 0 ? ` ${badges.join(" ")}` : "";
  const roleNames =
    f.roles && f.roles.length > 0
      ? f.roles.map((id) => roleIdToName.get(id) ?? `${id} ⚠`).join(" ")
      : "";
  const roleSuffix = roleNames
    ? ` <span style="color:#64748b;font-weight:400;font-size:0.85em">· ${escapeHtml(roleNames)}</span>`
    : "";
  return {
    content: escapeHtml(f.name) + badgeSuffix + roleSuffix,
    payload: {
      featureRef: { moduleId, featureId: f.id }
    },
    children: []
  };
}

