# DataMaker

[English](README.md)

DataMaker 是一款本地优先的元数据管理桌面应用，采用 Electron、React、TypeScript、Node.js 和 SQLite 构建。

项目默认使用英文，包括应用界面、源代码、文档和提交信息。桌面应用可通过页头的语言选择器切换为简体中文。

## 当前功能

- Electron 安全窗口与 sandboxed preload 白名单 API
- Node.js 共享应用服务及仅允许回环访问的 Fastify API
- 基于 `node:sqlite` 的 SQLite、WAL、外键、FTS5 和规范化初始模型
- 六类默认元数据质量规则
- 元数据统计与全文搜索工作台
- 权重、字典/树形字典、要素、数据表/私有表、每日增量、数据立方和表分类 CRUD
- SQL 与 SQLite 元数据导入及可跟踪的导入任务
- 英文和简体中文界面，默认使用英文

旧系统逆向文档目前为中文：

- [项目详细设计](project-detailed-design.zh-CN.md)
- [项目数据字典](project-data-dictionary.zh-CN.md)

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

应用数据库位于 Electron `app.getPath('userData')` 目录。导入外部 SQLite 元数据时，源数据库以只读模式打开。

## 项目语言约定

源代码、代码注释、分支名称、提交信息、PR 标题和默认文档统一使用英文。本地化文档使用明确的语言后缀，例如 `.zh-CN.md`。详细约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。
