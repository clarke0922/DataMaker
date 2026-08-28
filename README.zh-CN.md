# DataMaker

[English](README.md)

DataMaker 是一款本地优先的元数据管理桌面应用，采用 Electron、React、TypeScript、Node.js 和 SQLite 构建。

项目默认使用英文，包括应用界面、源代码、文档和提交信息。桌面应用可通过页头的语言选择器切换为简体中文，默认主题为深色，也可切换为浅色。

## 当前功能

- 安全 Electron 窗口：启用沙箱和上下文隔离，仅通过白名单 preload API 通信
- 共享 Node.js 应用服务：同时支持 IPC 与仅监听 `127.0.0.1` 的 Fastify API
- SQLite 元数据库：启用 WAL、外键、事务、FTS5 全文检索和版本迁移
- 本地用户、角色、权限管理，强制执行 RBAC，会话有效期为 8 小时，密码使用 Argon2id 散列
- 强制密码复杂度，并在连续 5 次登录失败后临时锁定 15 分钟
- 外部 SQLite 与 DDL SQL 文件采集，支持 UTF-8/GBK、差异预览、后台任务、取消和失败恢复
- Excel 工作表元数据导入，支持规范化表名并统计数据行数
- 元数据表与字段浏览、注释、标签、保存查询及中英文全文搜索
- 数据库外键、命名推断关系与人工逻辑关系管理，并保留字段映射和置信度
- 7 类元数据质量规则、后台运行、结果统计与问题明细
- 权重、字典、树形字典、要素、外部导入、数据表、私有表、每日增量、数据立方和表分类管理
- 可取消的后台 Markdown 数据字典导出、有界审计日志、手工备份恢复、保留最近 5 份每日自动备份、迁移前快照及恢复后搜索索引重建
- 正式打包版本支持检查 GitHub Releases、显示下载进度，并在用户确认后重启安装
- 数据字典包含主键、外键、索引、标签、注释和关系字段映射
- 英文和简体中文界面，默认英文；深色和浅色主题，默认深色

旧系统逆向分析文档：

- [项目详细设计](project-detailed-design.zh-CN.md)
- [项目数据字典](project-data-dictionary.zh-CN.md)

## 本地开发

要求 Node.js 22 或更高版本、pnpm 11 或更高版本。

```bash
pnpm install
pnpm build
pnpm --filter @datamaker/desktop start
```

开发模式使用：

```bash
pnpm dev
```

首次启动时创建的第一个本地账号会自动成为管理员。

## 测试与打包

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm run package:dir
```

使用 `pnpm dist:win` 生成 Windows NSIS 安装包；在 macOS 上使用 `pnpm dist:mac` 生成通用 DMG。Windows 签名使用 electron-builder 标准的 `CSC_LINK` 和 `CSC_KEY_PASSWORD` 环境变量；macOS 已启用 Hardened Runtime，并预留签名和公证配置。

应用数据库位于 Electron `app.getPath('userData')` 目录。外部 SQLite 数据源在采集期间以只读模式打开。本地自动化 API 的随机端口、15 分钟临时令牌及到期时间写入同一用户数据目录下权限受限的 `local-api.json`，应用退出时删除。

## 项目语言约定

### 旧元数据库验证

使用以下命令核对旧元数据 SQL 是否符合 87 张系统表、634 个字段的基线，
并验证 `META_TABLE`、`META_COLUMN` 可转换记录：

```bash
pnpm verify:legacy -- C:\path\to\meta.sql
```

验证过程只读取输入文件并使用临时数据库。无法可靠转换的旧模块初始化数据
会按模块计数写入迁移报告，不会静默丢弃或强行写入首期模型。

使用以下命令验证 10 万字段规模下的分页查询和全文检索性能：

```bash
pnpm verify:scale
```

源代码、代码注释、分支名、提交信息、PR 标题和默认文档统一使用英文。本地化文档使用明确的语言后缀，例如 `.zh-CN.md`。详细约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。
