import type { ModuleColor } from "@atlas/shared";
import { parseMarkdownWithFrontmatter } from "./markdownParser";

export class AggregateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AggregateValidationError";
  }
}

export interface AggregateProduct {
  id: string;
  name: string;
  description: string;
}

export interface AggregateFeature {
  id: string;
  name: string;
  description: string;
  /** 三层架构中层 id(强烈建议填) */
  module_group?: string;
  /** 角色 id 列表(逗号分隔填入,parser 切分) */
  roles?: string[];
  /** 中形态:操作的实体规范名清单(逗号分隔) */
  entities_touched?: string[];
  /** 中形态:归属层(org / campus / follows:Entity / shared) */
  ownership?: string;
}

export interface AggregateModule {
  id: string;
  name: string;
  role: string;
  color: ModuleColor;
  order: number | null;
  role_desc: string;
  features: AggregateFeature[];
}

export interface AggregateParsed {
  product: AggregateProduct;
  modules: AggregateModule[];
}

const KEBAB_RE = /^[a-z][a-z0-9-]*$/;
const VALID_COLORS: ModuleColor[] = [
  "red",
  "blue",
  "green",
  "yellow",
  "purple",
  "indigo",
  "gray"
];

interface DocFrontmatter {
  product_id?: string;
  product_name?: string;
}

/**
 * 解析单文件汇总 md。结构见 ATLAS-SPEC.md "单文件汇总导入格式" 一节。
 *
 * 抛 AggregateValidationError 描述具体哪一条失败,不部分返回。
 */
export function parseAggregateMd(source: string): AggregateParsed {
  const fm = parseMarkdownWithFrontmatter<DocFrontmatter>(source, {});
  const productId = fm.frontmatter.product_id?.trim();
  const productName = fm.frontmatter.product_name?.trim();
  if (!productId) {
    throw new AggregateValidationError("frontmatter 缺 product_id");
  }
  if (!KEBAB_RE.test(productId)) {
    throw new AggregateValidationError(`product_id "${productId}" 不是 kebab-case`);
  }
  if (!productName) {
    throw new AggregateValidationError("frontmatter 缺 product_name");
  }

  const body = fm.body;
  // 产品概述: 找 ## 产品概述 段
  const productDescription = extractSection(body, /^##\s+产品概述\s*$/m);

  // 把 body 按 "## 模块: xxx" 切分
  const moduleBlocks = splitByModuleHeading(body);
  if (moduleBlocks.length === 0) {
    throw new AggregateValidationError('未找到任何 "## 模块: xxx" 标题');
  }

  const modules: AggregateModule[] = moduleBlocks.map((block, idx) =>
    parseModuleBlock(block, idx)
  );

  // 全产品级唯一性校验
  const moduleIds = new Set<string>();
  const featureIds = new Set<string>();
  for (const mod of modules) {
    if (moduleIds.has(mod.id)) {
      throw new AggregateValidationError(`模块 id 重复: ${mod.id}`);
    }
    moduleIds.add(mod.id);
  }
  for (const mod of modules) {
    for (const feat of mod.features) {
      if (featureIds.has(feat.id)) {
        throw new AggregateValidationError(`功能点 id 在产品内重复: ${feat.id}`);
      }
      featureIds.add(feat.id);
    }
  }

  return {
    product: {
      id: productId,
      name: productName,
      description: productDescription
    },
    modules
  };
}

interface ModuleBlock {
  heading: string; // 原 "## 模块: 销售模块" 标题文本
  body: string;
}

function splitByModuleHeading(body: string): ModuleBlock[] {
  const re = /^##\s+模块:\s*(.+)$/gm;
  const matches: { idx: number; heading: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    matches.push({ idx: m.index, heading: m[1].trim() });
  }
  const blocks: ModuleBlock[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].idx;
    const end = i + 1 < matches.length ? matches[i + 1].idx : body.length;
    // 跳过本行(从行尾开始取 body)
    const lineEnd = body.indexOf("\n", start);
    const blockBody = body.slice(lineEnd + 1, end).trim();
    blocks.push({ heading: matches[i].heading, body: blockBody });
  }
  return blocks;
}

function parseModuleBlock(block: ModuleBlock, idx: number): AggregateModule {
  // 在 "### 职责" 之前的区域里找 - id: xxx / - role: xxx / - color: xxx / - order: N
  const headerEnd = block.body.search(/^###\s+职责\s*$/m);
  const headerRegion = headerEnd >= 0 ? block.body.slice(0, headerEnd) : block.body;

  const id = pickKv(headerRegion, "id");
  const role = pickKv(headerRegion, "role");
  const colorRaw = pickKv(headerRegion, "color");
  const orderRaw = pickKv(headerRegion, "order");

  if (!id) {
    throw new AggregateValidationError(
      `模块 "${block.heading}" 缺 id`
    );
  }
  if (!KEBAB_RE.test(id)) {
    throw new AggregateValidationError(`模块 "${block.heading}" 的 id "${id}" 不是 kebab-case`);
  }
  if (!role) {
    throw new AggregateValidationError(`模块 "${block.heading}" 缺 role`);
  }
  if (!colorRaw) {
    throw new AggregateValidationError(`模块 "${block.heading}" 缺 color`);
  }
  if (!VALID_COLORS.includes(colorRaw as ModuleColor)) {
    throw new AggregateValidationError(
      `模块 "${block.heading}" 的 color "${colorRaw}" 不在枚举 ${VALID_COLORS.join("/")} 中`
    );
  }

  let order: number | null = null;
  if (orderRaw !== null) {
    const n = Number.parseInt(orderRaw, 10);
    if (Number.isNaN(n)) {
      throw new AggregateValidationError(
        `模块 "${block.heading}" 的 order "${orderRaw}" 不是数字`
      );
    }
    order = n;
  }

  const role_desc = extractSection(block.body, /^###\s+职责\s*$/m);
  const featuresSection = extractSection(block.body, /^###\s+功能点\s*$/m);
  const features = parseFeaturesSection(featuresSection, id);

  return {
    id,
    name: block.heading,
    role,
    color: colorRaw as ModuleColor,
    order,
    role_desc,
    features
  };
}

function parseFeaturesSection(section: string, moduleId: string): AggregateFeature[] {
  if (!section.trim()) return [];

  // 切分 "#### xxx" 块
  const re = /^####\s+(.+)$/gm;
  const matches: { idx: number; heading: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(section)) !== null) {
    matches.push({ idx: m.index, heading: m[1].trim() });
  }
  const features: AggregateFeature[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].idx;
    const end = i + 1 < matches.length ? matches[i + 1].idx : section.length;
    const lineEnd = section.indexOf("\n", start);
    const block = section.slice(lineEnd + 1, end).trim();

    const id = pickKv(block, "id");
    if (!id) {
      throw new AggregateValidationError(
        `模块 ${moduleId} 的功能点 "${matches[i].heading}" 缺 id`
      );
    }
    if (!KEBAB_RE.test(id)) {
      throw new AggregateValidationError(
        `模块 ${moduleId} 的功能点 "${matches[i].heading}" 的 id "${id}" 不是 kebab-case`
      );
    }
    const description = extractDescriptionLine(block);
    const module_group = pickKv(block, "module_group") ?? undefined;
    const rolesRaw = pickKv(block, "roles");
    const roles = rolesRaw ? parseCommaList(rolesRaw) : undefined;
    const entitiesRaw = pickKv(block, "entities_touched");
    const entities_touched = entitiesRaw ? parseCommaList(entitiesRaw) : undefined;
    const ownership = pickKv(block, "ownership") ?? undefined;

    const f: AggregateFeature = { id, name: matches[i].heading, description };
    if (module_group) f.module_group = module_group;
    if (roles && roles.length > 0) f.roles = roles;
    if (entities_touched && entities_touched.length > 0) f.entities_touched = entities_touched;
    if (ownership) f.ownership = ownership;
    features.push(f);
  }
  return features;
}

/** "a, b, c" / "a,b,c" / "[a, b, c]" 都接受,trim 空白,去空项 */
function parseCommaList(raw: string): string[] {
  const cleaned = raw.replace(/^\[|\]$/g, "").trim();
  if (!cleaned) return [];
  return cleaned
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * 从 "描述：xxx" 或 "描述: xxx" 行抽取描述。允许多行,直到下一个空行/块边界。
 */
function extractDescriptionLine(block: string): string {
  const lines = block.split("\n");
  let started = false;
  const collected: string[] = [];
  for (const line of lines) {
    if (!started) {
      const m = line.match(/^描述\s*[:：]\s*(.*)$/);
      if (m) {
        started = true;
        if (m[1].trim()) collected.push(m[1].trim());
      }
      continue;
    }
    // 已经开始: 遇到下一个 list item (- id: ...) 或 heading 视为结束
    if (/^-\s+\w+\s*[:：]/.test(line.trim())) break;
    if (/^#+\s/.test(line.trim())) break;
    if (line.trim() === "") {
      // 第一行空白允许;如果已经有 collected,空行也结束
      if (collected.length > 0) break;
      continue;
    }
    collected.push(line.trim());
  }
  return collected.join("\n");
}

/** 在文本里抓 `- key: value` 行的 value。未找到返回 null。 */
function pickKv(text: string, key: string): string | null {
  const re = new RegExp(`^-\\s*${key}\\s*[:：]\\s*(.+)$`, "m");
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

/** 提取 heading 段(支持正则 heading 形式),止于下一个同级或更高级标题。 */
function extractSection(markdown: string, headingPattern: RegExp): string {
  // 找 heading 行
  const m = markdown.match(headingPattern);
  if (!m || m.index === undefined) return "";
  const headingText = m[0];
  // 推断级别
  const levelMatch = headingText.match(/^(#+)/);
  if (!levelMatch) return "";
  const level = levelMatch[1].length;
  // 构造"下一个 <= 该级别标题"的正则
  const sameOrHigher = new RegExp(`^#{1,${level}}\\s+`, "m");
  const headingEnd = markdown.indexOf("\n", m.index);
  const rest = markdown.slice(headingEnd + 1);
  const next = rest.search(sameOrHigher);
  const sectionBody = next >= 0 ? rest.slice(0, next) : rest;
  return sectionBody.trim();
}
