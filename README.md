# DataMaker

本地优先的元数据管理桌面应用，采用 Electron、React、TypeScript、Node.js 和 SQLite。

## 当前可运行切片

- Electron 安全窗口与 sandboxed preload 白名单 API
- Node.js 共享应用服务及仅回环访问的 Fastify API
- SQLite（`node:sqlite`）WAL、外键、FTS5 和首版核心模式
- 六类默认元数据质量规则
- 元数据统计与全文搜索工作台
- 权重、字典/树形字典、要素、数据表/私有表、每日增量、数据立方和表分类 CRUD
- SQL 与 SQLite 外部文件扫描导入，导入任务可追踪
- 未初始化管理员状态提示

详细设计见[项目详细设计](项目详细设计.md)，旧库完整字段见[项目数据字典](项目数据字典.md)。

## 本地开发

要求 Node.js 22+ 与 pnpm 11+。

```bash
pnpm install
pnpm build
pnpm --filter @datamaker/desktop start
```

Windows PowerShell 若禁止执行 `pnpm.ps1`，可使用 `pnpm.cmd`。

## 验证

```bash
pnpm typecheck
pnpm test
pnpm build
```

应用数据库位于 Electron `app.getPath('userData')` 目录。外部 SQLite 数据源在后续采集迭代中始终以只读方式打开。
