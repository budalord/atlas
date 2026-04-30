# Atlas

Atlas 是一个单人使用的、Agent-native 的多产品规格管理系统。MVP 使用本地 markdown/yaml 文件作为数据源，通过 Express API 读取后在 Vite React 前端渲染。

## 启动

```bash
npm install
npm run dev
```

启动后访问:

- 前端: http://127.0.0.1:5173
- API: http://127.0.0.1:3001/api/health

## 添加新产品

1. 在 `data/products/` 下创建目录，例如 `data/products/my-product/`。
2. 添加 `meta.yml`，字段遵守 `docs/DATA-MODEL.md`。
3. 添加 `STATUS.md`，保留固定 frontmatter、待办、阻塞、功能点和流程图结构。
4. 如有跨产品接口，在 `data/contracts/` 下新增契约 markdown。
5. 保存文件后，API 的 chokidar 监听会更新数据版本，前端会自动重新拉取。

## MVP 已包含

- 产品总览和产品卡片。
- 单产品详情、状态 markdown 渲染、功能点表格。
- 契约列表和契约 markdown 查看。
- 复制产品上下文指令。
- `CLAUDE.md` 中心。
- 本地文件读取 API 和文件监听。

## 不包含

登录认证、数据库、Docker、CI、部署配置、健康度计算、变更历史、关联图、双轨设计区、AI 触点管理、今日聚焦和导出。
