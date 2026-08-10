# 项目数据字典

> 生成依据：`meta.sql`。本文区分 **SQL 事实**、**设计推断** 与 **目标态设计**。旧库未声明外键，任何跨表关系均不能视为数据库已实施约束。

## 1. 数据概览

| 指标 | 数量 |
|---|---:|
| 旧库表 | 87 |
| 字段 | 634 |
| 有主键的表 | 85 |
| 无主键的表 | 2 |
| 唯一约束 | 5 |
| 显式外键 | 0 |

## 2. 目标态 SQLite 核心模型

> **目标态设计**：以下为新桌面应用的规范化模型分组，具体建表 DDL 在实施阶段通过 Drizzle migration 固化。

| 表/表组 | 用途 | 核心内容 |
|---|---|---|
| users | 本地用户 | id, username, password_hash, display_name, status, created_at, updated_at |
| roles / permissions | RBAC 角色与权限 | 角色、权限及 user_roles、role_permissions 关联 |
| data_sources | 采集数据源 | 类型、名称、配置引用、状态、最近采集时间 |
| scan_jobs | 采集任务 | 任务状态、进度、差异摘要、错误信息 |
| catalogs / schemas | 数据目录层级 | 数据源下的 catalog 与 schema |
| meta_tables / meta_columns | 核心元数据 | 表、视图、字段、类型、约束、原始 DDL |
| table_relations / relation_columns | 表关系 | 物理/推断/人工关系、置信度及字段映射 |
| tags / object_tags | 标签 | 元数据对象的分类与检索标签 |
| quality_rules | 质量规则 | 规则类型、配置、严重级别和启用状态 |
| rule_runs / rule_results | 规则执行 | 运行状态、统计结果及逐项问题 |
| saved_queries | 保存的查询 | 用户检索条件和展示配置 |
| audit_logs | 审计日志 | 用户、动作、对象、结果、时间和上下文 |
| app_settings | 应用设置 | 非敏感应用配置；密钥保存至系统密钥链 |
| schema_migrations | 模式版本 | SQLite 数据库迁移版本和校验信息 |

### 2.1 通用约束

- 主键统一为 UUID 文本；时间统一保存 UTC ISO-8601。
- 启用 `PRAGMA foreign_keys = ON`、WAL 和事务；布尔字段使用带 CHECK 的 0/1。
- FTS5 索引表名、字段名、注释和标签；FTS 索引由事务内同步逻辑维护。
- 外部数据源密钥仅保存系统密钥链引用，不保存明文。
- 原始类型、默认值和 DDL单独保留，标准化结果不可覆盖原始证据。

## 3. 旧库模块清单

| 前缀 | 模块 | 表数 | 字段数 | 说明 |
|---|---|---:|---:|---|
| WEB | 门户与即时通信 | 12 | 70 | 栏目、文章、图片、导航和即时通信 |
| TABLE | 导入与字段管理 | 2 | 11 | 内部表识别任务和字段管理 |
| SYS | 系统与权限 | 18 | 125 | 用户、组织、岗位、角色、菜单、操作、日志及系统配置 |
| RULE | 规则分析 | 7 | 58 | 规则树、节点、规则元数据、运行日志及结果文件 |
| QUERY | 查询统计 | 3 | 23 | 查询条件、关联视图及统计对象 |
| POWER | 数据权限 | 10 | 66 | 岗位及模板的表、行、列级权限 |
| MSG | 消息管理 | 4 | 25 | 收发消息、联系人和附件 |
| META | 元数据管理 | 14 | 95 | 元数据表、字段、分类、关系、分表、继承及变更记录 |
| JS | 检索与索引 | 7 | 46 | 索引任务、目录授权、文档索引及关键词统计 |
| COMPARE | 数据比对 | 5 | 65 | 库间、文件及 Excel 数据比对 |
| BUSINESS | 业务任务 | 5 | 50 | 任务类型、任务分解、处理及反馈 |

## 4. 旧库逐表字段字典

### 4.1 门户与即时通信（WEB）

#### WEB_URL

- 表说明：资源导航
- 主键：`WU_ID`
- 唯一约束：无
- 迁移建议：首期作为历史数据分析依据，按需迁移

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| WU_ID | VARCHAR(64) | 否 | - | 是 | 资源导航ID |
| WU_NAME | VARCHAR(64) | 是 | - |  | 导航名称 |
| WU_URL | VARCHAR(3000) | 是 | - |  | 地址 |
| WU_IMAGE | VARCHAR(3000) | 是 | - |  | 导航图片 |
| WU_TITLE | VARCHAR(320) | 是 | - |  | 说明 |
| WU_TARGET | VARCHAR(64) | 是 | - |  | 弹出方式 |
| WU_ORDER | DEC(10,0) | 是 | - |  | 排序号 |

#### WEB_PICTURE_LIBRARY

- 表说明：图片库
- 主键：`WP_ID`
- 唯一约束：无
- 迁移建议：首期作为历史数据分析依据，按需迁移

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| WP_ID | VARCHAR(64) | 否 | - | 是 | 图片ID |
| WC_ID | VARCHAR(64) | 是 | - |  | 文章ID |
| WP_NAME | VARCHAR(300) | 是 | - |  | 图片名称 |
| WP_SUFFIX | VARCHAR(100) | 是 | - |  | 图片后缀名 |
| WP_DESC | VARCHAR(2000) | 是 | - |  | 图片描述 |
| WP_ORDER | DEC(10,0) | 是 | - |  | 图片排序号 |
| WP_FILE | BLOB | 是 | - |  | 图片二进制文件 |

#### WEB_IM_GROUP_USRE

- 表说明：群组成员
- 主键：`WIGU_ID`
- 唯一约束：无
- 迁移建议：首期作为历史数据分析依据，按需迁移

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| WIGU_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| WIG_ID | VARCHAR(64) | 是 | - |  | 群ID |
| SU_ID | VARCHAR(64) | 是 | - |  | 群成员 |
| WIGU_JOIN_TIME | TIMESTAMP(6) | 是 | - |  | 入群时间 |

#### WEB_IM_GROUP_UNREAD

- 表说明：群聊天记录查看状态
- 主键：`WIGCS_ID`
- 唯一约束：无
- 迁移建议：首期作为历史数据分析依据，按需迁移

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| WIGCS_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| WIGC_ID | VARCHAR(64) | 否 | - |  | 聊天记录ID |
| WIG_ID | VARCHAR(64) | 否 | - |  | 群ID |
| WIGCS_READ_USER | VARCHAR(64) | 是 | - |  | 未读人 |

#### WEB_IM_GROUP_CHAT

- 表说明：群聊天记录
- 主键：`WIGC_ID`
- 唯一约束：无
- 迁移建议：首期作为历史数据分析依据，按需迁移

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| WIGC_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| WIG_ID | VARCHAR(64) | 否 | - |  | 群ID |
| WIGC_SPEAK_USRE | VARCHAR(64) | 是 | - |  | 说话人 |
| WIGC_CONTENT | VARCHAR(3000) | 是 | - |  | 说话内容 |
| WIGC_TIME | TIMESTAMP(6) | 是 | - |  | 说话时间 |

#### WEB_IM_GROUP

- 表说明：群组
- 主键：`WIG_ID`
- 唯一约束：无
- 迁移建议：首期作为历史数据分析依据，按需迁移

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| WIG_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| WIG_NAME | VARCHAR(64) | 是 | - |  | 群名称 |
| WIG_CREATE_USRE | VARCHAR(64) | 是 | - |  | 创建人 |
| WIG_CREATE_TIME | TIMESTAMP(6) | 是 | - |  | 创建时间 |
| WIG_IMG | VARCHAR(500) | 是 | - |  | 群图片 |
| WIG_REMARK | VARCHAR(500) | 是 | - |  | 备注 |

#### WEB_IM

- 表说明：即时通讯
- 主键：`WI_ID`
- 唯一约束：无
- 迁移建议：首期作为历史数据分析依据，按需迁移

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| WI_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| WI_FROM | VARCHAR(64) | 是 | - |  | 发送人 |
| WI_TO | VARCHAR(64) | 是 | - |  | 接收人 |
| WI_SENDTIME | TIMESTAMP(6) | 是 | - |  | 发送时间 |
| WI_CONTENT | VARCHAR(3000) | 是 | - |  | 对话内容 |
| WI_STATUS | VARCHAR(4) | 是 | - |  | 状态 |

#### WEB_CATEGORIES_ROLE

- 表说明：栏目与角色关联关系
- 主键：`WCR_ID`
- 唯一约束：无
- 迁移建议：首期作为历史数据分析依据，按需迁移

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| WCR_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| WC_ID | VARCHAR(64) | 否 | - |  | 栏目ID |
| SR_ID | VARCHAR(64) | 否 | - |  | 角色ID |
| WCR_STATE | VARCHAR(64) | 否 | - |  | 状态 |

#### WEB_CATEGORIES

- 表说明：栏目
- 主键：`WC_ID`
- 唯一约束：无
- 迁移建议：首期作为历史数据分析依据，按需迁移

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| WC_ID | VARCHAR(64) | 否 | - | 是 | 栏目ID |
| WC_NAME | VARCHAR(30) | 是 | - |  | 栏目名称 |
| WC_PARENTID | VARCHAR(64) | 是 | - |  | 上级栏目ID |
| WC_LEVEL | VARCHAR(500) | 是 | - |  | 栏目级别 |
| WC_ORDER | DEC(10,0) | 是 | - |  | 栏目排序号 |
| WC_TYPE | VARCHAR(10) | 是 | - |  | 栏目类型 |

#### WEB_ARTICLE_USER

- 表说明：用户查看文章信息
- 主键：`WAU_ID`
- 唯一约束：无
- 迁移建议：首期作为历史数据分析依据，按需迁移

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| WAU_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| WA_ID | VARCHAR(64) | 否 | - |  | 文章ID |
| SU_ID | VARCHAR(64) | 否 | - |  | 用户ID |

#### WEB_ARTICLE_POWER

- 表说明：文章授权表(SP)
- 主键：`WAP_ID`
- 唯一约束：无
- 迁移建议：首期作为历史数据分析依据，按需迁移

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| WAP_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| WA_ID | VARCHAR(64) | 否 | - |  | 文章主键 |
| SU_ID | VARCHAR(64) | 否 | - |  | 用户主键 |

#### WEB_ARTICLE

- 表说明：文章
- 主键：`WA_ID`
- 唯一约束：无
- 迁移建议：首期作为历史数据分析依据，按需迁移

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| WA_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| WC_ID | VARCHAR(64) | 否 | - |  | 栏目ID |
| WA_TITLE | VARCHAR(255) | 是 | - |  | 文章标题 |
| WA_CONTENT | CLOB | 是 | - |  | 文章内容 |
| WA_POSTDATE | TIMESTAMP(6) | 是 | - |  | 发布时间 |
| WA_POSTBY | VARCHAR(64) | 是 | - |  | 发布人 |
| WA_HIT | INT | 是 | '0' |  | 浏览次数 |
| WA_ORDER | NUMBER(10,0) | 是 | - |  | 文章排序号 |
| WA_TOP | INT | 是 | '0' |  | 置顶状态 |
| WA_STATUS | INT | 是 | '0' |  | 审核状态 |
| WA_FILE | BLOB | 是 | - |  | 附件 |
| WA_FILENAME | VARCHAR(255) | 是 | - |  | 附件名 |
| WA_FILEPATH | VARCHAR(2000) | 是 | - |  | - |
| WA_IMAGE | BLOB | 是 | - |  | 图片 |
| WA_WC_TYPE | VARCHAR(10) | 是 | - |  | 类型 |

### 4.2 导入与字段管理（TABLE）

#### TABLE_IMPORTINNER_TASK

- 表说明：识别内部表任务
- 主键：`TI_ID`
- 唯一约束：无
- 迁移建议：首期作为历史数据分析依据，按需迁移

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| TI_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| TI_DES_TABLE_ID | VARCHAR(64) | 是 | - |  | 目的表英文名 |
| TI_DES_TABLE_NAME | VARCHAR(400) | 是 | - |  | 目的表中文名称 |
| TI_SOU_TABLE_NAME | VARCHAR(400) | 是 | - |  | 源表中文名称 |
| TI_MAX_ROWID | VARCHAR(500) | 是 | - |  | 上次插入数据位置 |
| TI_CREATE_TIME | TIMESTAMP(6) | 是 | - |  | 任务创建时间 |
| TI_STATUS | INT | 是 | 0 |  | 任务状态（0:未执行，1：完成，2：进行中，3：失败） |

#### TABLE_COLUMN_MANAGER

- 表说明：字段管理表
- 主键：`MM_ID`
- 唯一约束：无
- 迁移建议：首期作为历史数据分析依据，按需迁移

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| MM_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| MM_TNAME | VARCHAR(100) | 是 | - |  | 表英文名 |
| MM_CNAME | VARCHAR(100) | 是 | - |  | 字段英文名 |
| MM_TYPE | INTEGER | 是 | - |  | 字段管理类型(0显示，1查询，2标题) |

### 4.3 系统与权限（SYS）

#### SYS_USER_ROLE

- 表说明：用户角色表(SUR)
- 主键：`SUR_ID`
- 唯一约束：无
- 迁移建议：仅迁移本地 RBAC 所需账号、角色和权限语义

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| SUR_ID | VARCHAR(64) | 否 | - | 是 | 用户角色ID |
| SU_ID | VARCHAR(64) | 否 | - |  | 用户ID |
| SR_ID | VARCHAR(64) | 否 | - |  | 角色ID |
| SUR_STATE | VARCHAR(10) | 否 | - |  | 审核状态 |

#### SYS_USER_JOB

- 表说明：用户岗位关联表
- 主键：`SUJ_ID`
- 唯一约束：CONS_USER(SU_ID)
- 迁移建议：仅迁移本地 RBAC 所需账号、角色和权限语义

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| SUJ_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| SU_ID | VARCHAR(64) | 否 | - |  | 用户表主键 |
| SJ_ID | VARCHAR(64) | 否 | - |  | 岗位表主键 |
| SUJ_STATUS | VARCHAR(10) | 否 | - |  | 状态 |

#### SYS_USER

- 表说明：用户表(SU)
- 主键：`SU_ID`
- 唯一约束：无
- 迁移建议：仅迁移本地 RBAC 所需账号、角色和权限语义

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| SU_ID | VARCHAR(64) | 否 | - | 是 | 用户ID |
| SU_CODE | VARCHAR(50) | 是 | - |  | 用户帐号 |
| SU_NAME | VARCHAR(50) | 是 | - |  | 用户姓名 |
| SU_SEX | VARCHAR(4) | 是 | - |  | 性别 |
| SU_PASSWORD | VARCHAR(64) | 是 | - |  | 用户密码 |
| SU_STATUS | VARCHAR(1) | 是 | - |  | 用户状态：0未启用 1启用 2禁用 |
| SU_CONTACT | VARCHAR(100) | 是 | - |  | 联系方式 |
| SU_EMAIL | VARCHAR(200) | 是 | - |  | 邮箱 |
| SU_TYPE | VARCHAR(1) | 是 | - |  | 用户身份：1超级管理员 2内置用户 3普通用户 |
| SU_CONTENT | VARCHAR(1000) | 是 | - |  | 备注 |
| SU_RANDOM | VARCHAR(10) | 是 | - |  | 登录随机数,用于加强系统登录安全 |
| SO_ID | VARCHAR(64) | 是 | - |  | 单位ID |
| SU_PHOTO | BLOB | 是 | - |  | 用户图片 |
| SU_LOCK | INTEGER | 是 | - |  | 是否锁定 |
| SU_LASTMODIFYTIME | DATE | 是 | - |  | 最后登录时间 |
| SU_ORDER | DEC(10,0) | 是 | - |  | 排序号 |
| KOAL_CERT_CN | VARCHAR(200) | 是 | - |  | 存储格尔KEY号，为了兼容格尔网关使用 |

#### SYS_ROLE_MENU

- 表说明：角色菜单表(SRM)
- 主键：`SRM_ID`
- 唯一约束：无
- 迁移建议：仅迁移本地 RBAC 所需账号、角色和权限语义

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| SRM_ID | VARCHAR(64) | 否 | - | 是 | 角色菜单ID |
| SR_ID | VARCHAR(64) | 否 | - |  | 角色ID |
| SM_ID | VARCHAR(64) | 否 | - |  | 菜单ID |
| SRM_STATE | VARCHAR(10) | 否 | - |  | 审核状态 |

#### SYS_ROLE_ACTION

- 表说明：角色菜单功能分配表(SRA)
- 主键：`SRA_ID`
- 唯一约束：无
- 迁移建议：仅迁移本地 RBAC 所需账号、角色和权限语义

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| SRA_ID | VARCHAR(64) | 否 | - | 是 | 角色功能ID |
| SR_ID | VARCHAR(64) | 否 | - |  | 角色ID |
| SM_ID | VARCHAR(64) | 否 | - |  | 菜单ID |
| SA_ID | VARCHAR(64) | 否 | - |  | 功能ID |

#### SYS_ROLE

- 表说明：角色表(SR)
- 主键：`SR_ID`
- 唯一约束：无
- 迁移建议：仅迁移本地 RBAC 所需账号、角色和权限语义

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| SR_ID | VARCHAR(64) | 否 | - | 是 | 角色ID |
| SR_CODE | VARCHAR(30) | 是 | - |  | 角色编码，用于定义工作流 |
| SR_NAME | VARCHAR(30) | 是 | - |  | 角色名称 |
| SR_TYPE | VARCHAR(1) | 是 | - |  | 角色类型 1管理员角色, 2内置角色 3普通角色 |

#### sys_pinyin

- 表说明：汉字拼音表
- 主键：**无主键**
- 唯一约束：无
- 迁移建议：仅迁移本地 RBAC 所需账号、角色和权限语义

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| word | VARCHAR(2) | 否 | - |  | 汉字 |
| SOUND | VARCHAR(20) | 否 | - |  | 带声调拼音 |
| tune | VARCHAR(1) | 否 | - |  | 声调 |
| sound_code | VARCHAR(10) | 否 | - |  | 不带声调拼音 |

#### SYS_ORG

- 表说明：单位部门表(SO)
- 主键：`SO_ID`
- 唯一约束：无
- 迁移建议：仅迁移本地 RBAC 所需账号、角色和权限语义

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| SO_ID | VARCHAR(64) | 否 | - | 是 | 单位ID |
| SO_NAME | VARCHAR(100) | 是 | - |  | 单位名称 |
| SO_CODE | VARCHAR(30) | 是 | - |  | 单位编码 |
| SO_PARENTID | VARCHAR(64) | 是 | - |  | 上级单位ID |
| SO_ORDER | NUMBER(10,0) | 是 | - |  | 单位排序 |
| SO_CONTACT | VARCHAR(100) | 是 | - |  | 联系电话 |
| SO_EMAIL | VARCHAR(100) | 是 | - |  | 电子邮箱 |
| SO_POST | VARCHAR(20) | 是 | - |  | 邮政编码 |
| SO_PURVIEW | VARCHAR(2000) | 是 | - |  | 单位权限 |
| SO_ADDRESS | VARCHAR(200) | 是 | - |  | 单位地址 |
| SO_REGISTER | VARCHAR(50) | 是 | - |  | 登记人 |
| SO_REGISTERTIME | TIMESTAMP(6) | 是 | - |  | 登记时间 |
| SO_FULLNAME | VARCHAR(500) | 是 | - |  | 单位全称 |
| SO_ORGTYPE | VARCHAR(500) | 是 | - |  | 单位类型 |

#### SYS_OPER_TABLE

- 表说明：绩效统计表
- 主键：`SOT_ID`
- 唯一约束：无
- 迁移建议：仅迁移本地 RBAC 所需账号、角色和权限语义

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| SOT_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| MT_NAME | VARCHAR(100) | 是 | - |  | 数据表英文名 |
| SU_ID | VARCHAR(64) | 是 | - |  | 操作用户 |
| SO_ID | VARCHAR(64) | 是 | - |  | 操作部门 |
| SJ_ID | VARCHAR(64) | 是 | - |  | 操作岗位 |
| SOT_CREATE_TIME | DATETIME(6) | 是 | - |  | 操作时间 |
| SOT_OPERATE | CHAR(1) | 是 | - |  | 操作 |

#### SYS_OPER_DATA

- 表说明：数据绩效
- 主键：`SOD_ID`
- 唯一约束：无
- 迁移建议：仅迁移本地 RBAC 所需账号、角色和权限语义

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| SOD_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| MT_NAME | VARCHAR(100) | 是 | - |  | 数据表英文名 |
| DM_PK | VARCHAR(64) | 是 | - |  | 数据主键 |
| DM_SO_ID | VARCHAR(64) | 是 | - |  | 数据所属机构 |
| SOD_OPERATE | INTEGER | 是 | - |  | 操作(1查看 0修改) |
| SOD_CREATE_TIME | DATETIME(6) | 是 | - |  | 操作时间 |
| SU_ID | VARCHAR(64) | 是 | - |  | 操作用户 |
| SO_ID | VARCHAR(64) | 是 | - |  | 操作部门 |
| SJ_ID | VARCHAR(64) | 是 | - |  | 操作岗位 |

#### SYS_MENU

- 表说明：菜单表(SM)
- 主键：`SM_ID`
- 唯一约束：无
- 迁移建议：仅迁移本地 RBAC 所需账号、角色和权限语义

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| SM_ID | VARCHAR(64) | 否 | - | 是 | 菜单ID |
| SAP_ID | VARCHAR(64) | 否 | - |  | 应用系统ID |
| SM_NAME | VARCHAR(100) | 是 | - |  | 菜单名称 |
| SM_PARENTID | VARCHAR(64) | 是 | - |  | 父级菜单ID：0表示根菜单 |
| SM_ICON | VARCHAR(20) | 是 | - |  | 菜单图标样式 |
| SM_TYPE | VARCHAR(1) | 是 | - |  | 菜单类型：1菜单项 0分割线 |
| SM_ACTION | VARCHAR(100) | 是 | - |  | 菜单动作 |
| SM_ORDER | DEC(10,0) | 是 | - |  | 菜单顺序 |
| SM_CONTENT | VARCHAR(200) | 是 | - |  | 备注 |
| SM_ADMIN | VARCHAR(1) | 是 | - |  | 1管理员菜单;0用户菜单 |

#### SYS_LOG

- 表说明：系统日志表(SL)
- 主键：`SL_ID`
- 唯一约束：无
- 迁移建议：仅迁移本地 RBAC 所需账号、角色和权限语义

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| SL_ID | VARCHAR(64) | 否 | - | 是 | 日志ID |
| SL_DATE | TIMESTAMP(6) | 是 | - |  | 日志时间 |
| SL_USER_CODE | VARCHAR(50) | 是 | - |  | 登录账号 |
| SL_USER_NAME | VARCHAR(50) | 是 | - |  | 用户名称 |
| SL_ORG_NAME | VARCHAR(50) | 是 | - |  | 单位名称 |
| SL_IP | VARCHAR(200) | 是 | - |  | IP地址 |
| SL_CLASS | VARCHAR(200) | 是 | - |  | 类名称 |
| SL_METHOD | VARCHAR(100) | 是 | - |  | 方法名称 |
| SL_DESCRIPTION | VARCHAR(200) | 是 | - |  | 方法描述 |
| SL_CONTENT | CLOB | 是 | - |  | 日志内容 |
| SL_FLAG | VARCHAR(2) | 是 | 0 |  | 日志状态 |
| SL_BAK_FLAG | NUMBER | 是 | 0 |  | 日志备份次数 |

#### SYS_JOB

- 表说明：岗位表
- 主键：`SJ_ID`
- 唯一约束：无
- 迁移建议：仅迁移本地 RBAC 所需账号、角色和权限语义

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| SJ_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| SJ_NAME | VARCHAR(64) | 是 | - |  | 岗位名称 |
| SO_ID | VARCHAR(64) | 是 | - |  | 所属机构 |
| SJ_REMARK | VARCHAR(100) | 是 | - |  | 岗位描述 |
| SJ_CREATE_TIME | TIMESTAMP(6) | 是 | - |  | 创建时间 |
| SJ_ORDER | INTEGER | 是 | - |  | 排序 |

#### SYS_FILE

- 表说明：附件表
- 主键：`SF_ID`
- 唯一约束：无
- 迁移建议：仅迁移本地 RBAC 所需账号、角色和权限语义

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| SF_ID | VARCHAR(64) | 否 | - | 是 | 附件ID |
| SF_NAME | VARCHAR(300) | 是 | - |  | 上传文件名 |
| SF_RELATIVENAME | VARCHAR(200) | 是 | - |  | 上传文件标识符名 |
| SF_FIELDNAME | VARCHAR(200) | 是 | - |  | 关联字段名 |
| SF_INFOID | VARCHAR(200) | 是 | - |  | 信息对应ID |
| SF_TABLE | VARCHAR(200) | 是 | - |  | 信息对应表 |
| SF_DATE | TIMESTAMP(6) | 是 | - |  | 创建时间 |
| SF_BLOB | BLOB | 是 | - |  | - |

#### SYS_DICT

- 表说明：字典管理
- 主键：`SD_ID`
- 唯一约束：无
- 迁移建议：仅迁移本地 RBAC 所需账号、角色和权限语义

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| SD_ID | VARCHAR(64) | 否 | - | 是 | 字典ID |
| SD_CODE | VARCHAR(50) | 是 | - |  | 字典编号 |
| SD_DESCRIPTION | VARCHAR(200) | 是 | - |  | 字典含义 |
| SD_PARENT_ID | VARCHAR(64) | 是 | - |  | 上级字典ID |
| SD_PATH | VARCHAR(2000) | 是 | - |  | 字典路径 |
| SD_ORDER | DEC(10,0) | 是 | - |  | 排序号 |

#### SYS_DB_BACKUP

- 表说明：数据库备份表
- 主键：`SDB_ID`
- 唯一约束：无
- 迁移建议：仅迁移本地 RBAC 所需账号、角色和权限语义

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| SDB_ID | VARCHAR(64) | 否 | - | 是 | 备份文件ID |
| SDB_NAME | VARCHAR(300) | 是 | - |  | 备份名称 |
| SDB_SIZE | VARCHAR(300) | 是 | - |  | 备份文件大小 |
| SU_ID | VARCHAR(64) | 是 | - |  | 备份用户 |
| SDB_DATE | TIMESTAMP(6) | 是 | - |  | 备份时间 |

#### SYS_APP

- 表说明：应用系统表(SP)
- 主键：`SAP_ID`
- 唯一约束：无
- 迁移建议：仅迁移本地 RBAC 所需账号、角色和权限语义

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| SAP_ID | VARCHAR(64) | 否 | - | 是 | 系统表ID |
| SAP_CODE | VARCHAR(50) | 是 | - |  | 系统编号 |
| SAP_NAME | VARCHAR(50) | 是 | - |  | 系统名称 |

#### SYS_ACTION

- 表说明：菜单功能表(SA)
- 主键：`SA_ID`
- 唯一约束：无
- 迁移建议：仅迁移本地 RBAC 所需账号、角色和权限语义

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| SA_ID | VARCHAR(64) | 否 | - | 是 | 菜单功能ID |
| SM_ID | VARCHAR(64) | 否 | - |  | 菜单ID |
| SA_CLASS | VARCHAR(100) | 是 | - |  | 菜单类 |
| SA_GROUP | VARCHAR(20) | 是 | - |  | 功能分组 |

### 4.4 规则分析（RULE）

#### RULE_TREE

- 表说明：规则树型结构表
- 主键：`RT_ID`
- 唯一约束：无
- 迁移建议：仅迁移可转换的元数据质量规则

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| RT_ID | VARCHAR(32) | 否 | - | 是 | 主键 |
| RT_NAME | VARCHAR(100) | 是 | - |  | 分类名称 |
| RT_CREATE_TIME | TIMESTAMP(6) | 是 | - |  | 创建时间 |
| RT_CREATE_USER | VARCHAR(32) | 是 | - |  | 创建用户 |
| RT_CREATE_USERNAME | VARCHAR(50) | 是 | - |  | 创建用户名 |
| RT_TYPE | VARCHAR(4) | 是 | - |  | 类型: 11,12 我的规则分类/规则， 21,22 公共规则分类/规则， 31,32 排队中的规则分类/规则， 41,42 运行中的规则分类/规则， 51,52 记录审计日志的规则分类/规则 |
| RT_PARENT_ID | VARCHAR(32) | 是 | - |  | 父节点ID: 0为根节点 |
| RT_DESC | VARCHAR(1000) | 是 | - |  | 描述 |
| RT_SORT_CODE | NUMERIC(10,0) | 是 | - |  | 排序号 |
| RT_RESVD1 | VARCHAR(500) | 是 | - |  | 备用字段1  （此字段用于记录原来的规则id，在规则发布时使用，使用人徐欣） |
| RT_RESVD2 | VARCHAR(500) | 是 | - |  | 备用字段2 (此字段已用,用来记录规则运行的版本号,初始为0,修改一次加1) |
| RT_STATUS | VARCHAR(1) | 是 | - |  | 状态 0未暂停 1暂停中 |
| RT_XML | CLOB | 是 | - |  | 规则布局XML文件 |
| RT_LAST_DATE | TIMESTAMP(6) | 是 | - |  | 最近一次运行时间 |
| RT_VERSION | NUMERIC(18,0) | 是 | 0 |  | 规则版本号 |

#### RULE_RUNLOG

- 表说明：规则运行日志
- 主键：`RR_ID`
- 唯一约束：无
- 迁移建议：仅迁移可转换的元数据质量规则

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| RR_ID | VARCHAR(32) | 否 | - | 是 | 日志ID |
| RT_ID | VARCHAR(32) | 否 | - |  | 规则ID |
| RR_CONTENT | TEXT | 是 | - |  | 日志内容json格式 |

#### RULE_PLCX

- 表说明：批量查询结果表
- 主键：`RP_ID`
- 唯一约束：无
- 迁移建议：仅迁移可转换的元数据质量规则

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| RP_ID | VARCHAR(32) | 否 | - | 是 | 批量查询ID |
| RT_ID | VARCHAR(32) | 是 | - |  | 规则ID |
| RN_ID | VARCHAR(32) | 是 | - |  | 节点ID |
| RP_KEY_WORD | VARCHAR(100) | 是 | - |  | 关键字 |
| RP_IN_NAME | VARCHAR(100) | 是 | - |  | 查询表名 |
| RP_OUT_NAME | VARCHAR(100) | 是 | - |  | 输出表名称 |
| RP_NAME_CN | VARCHAR(100) | 是 | - |  | 表中文 |
| RP_TOTAL | DEC(18,0) | 是 | - |  | 结果数量 |

#### RULE_NODE

- 表说明：规则节点表
- 主键：`RT_ID` + `RN_ID`
- 唯一约束：无
- 迁移建议：仅迁移可转换的元数据质量规则

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| RT_ID | VARCHAR(32) | 否 | - | 是 | 规则ID |
| RN_ID | VARCHAR(32) | 否 | - | 是 | 节点ID |
| RN_NAME | VARCHAR(100) | 是 | - |  | 节点名称 |
| RN_CREATE_USER | VARCHAR(32) | 是 | - |  | 创建用户 |
| RN_TYPE | VARCHAR(50) | 是 | - |  | 类型（如：查询、批量查询、连接、交集、并集等） |
| RN_TABLE_NAME | VARCHAR(50) | 是 | - |  | 输出表名 |
| RN_OBJECT | TEXT | 是 | - |  | 存放节点对象（包含查询条件，排序，连接条件等） |
| RN_STATUS | VARCHAR(1) | 是 | - |  | 节点运行状态 0未运行 1已运行 2运行中 3运行错误 |

#### RULE_META_TABLE

- 表说明：规则分析元数据表
- 主键：`MT_ID`
- 唯一约束：CONS134219036(MT_NAME)
- 迁移建议：仅迁移可转换的元数据质量规则

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| MT_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| MT_NAME_CN | VARCHAR(100) | 是 | - |  | 表中文名 |
| MT_NAME | VARCHAR(100) | 是 | - |  | 表英文名 |
| MT_TYPE_IS_VIEW | INTEGER | 是 | - |  | 输出表类型(1.视图 0.临时表 ) |
| SU_ID | VARCHAR(64) | 是 | - |  | 创建人 |
| MT_CREATE_TIME | TIMESTAMP(6) | 是 | - |  | 创建时间 |
| MT_COUNT | NUMERIC | 是 | - |  | 记录总数 |

#### RULE_META_COLUMN

- 表说明：规则分析字段信息
- 主键：`MC_ID`
- 唯一约束：无
- 迁移建议：仅迁移可转换的元数据质量规则

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| MC_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| MT_NAME | VARCHAR(100) | 是 | - |  | 所属表(外键) |
| MC_NAME_CN | VARCHAR(100) | 是 | - |  | 中文名 |
| MC_NAME | VARCHAR(100) | 是 | - |  | 英文名 |
| MC_TYPE | VARCHAR(10) | 是 | - |  | 数据类型 |
| MC_LENGTH | INTEGER | 是 | - |  | 长度 |
| MC_PRECISION | INTEGER | 是 | - |  | 精度 |
| MC_VALUE_TYPE | INTEGER | 是 | - |  | 值类型(1固定值 2表达式) |
| MC_VALUE | VARCHAR(250) | 是 | - |  | 固定值或表达式 |
| MC_IS_DESC | INTEGER | 是 | '0' |  | 是否降序查询(0不排序 1降序2升序，默认值为0) |
| MC_ORDER | INTEGER | 是 | - |  | 排序号 |

#### RULE_FILE

- 表说明：规则运行中产生的文件
- 主键：`RF_ID`
- 唯一约束：无
- 迁移建议：仅迁移可转换的元数据质量规则

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| RF_ID | VARCHAR(32) | 否 | - | 是 | 主键 |
| RT_ID | VARCHAR(32) | 是 | - |  | 规则主键 |
| RN_ID | VARCHAR(32) | 是 | - |  | 节点主键 |
| RF_NAME | VARCHAR(500) | 是 | - |  | 文件中文名称 |
| RF_FILE | BLOB | 是 | - |  | 文件内容 |
| RF_OBJECT | TEXT | 是 | - |  | 记录用户选择列头相关信息 |

### 4.5 查询统计（QUERY）

#### QUERY_VIEW_RELATION

- 表说明：关联查询
- 主键：`QV_ID`
- 唯一约束：无
- 迁移建议：首期作为历史数据分析依据，按需迁移

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| QV_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| QV_NAME | VARCHAR(300) | 是 | - |  | 视图名称 |
| QV_NAME_CN | VARCHAR(300) | 是 | - |  | 关联查询名称 |
| QV_CREATE_TIME | TIMESTAMP(6) | 是 | - |  | 创建时间 |
| QV_CREATE_USER | VARCHAR(64) | 是 | - |  | 创建人 |
| QV_SHOW_COLUMNS | CLOB | 是 | - |  | 关联查询显示字段 |
| QV_RELATED_COLUMNS | CLOB | 是 | - |  | 关联查询关联字段 |

#### QUERY_STATISTICS

- 表说明：统计分析中对象
- 主键：`QS_ID`
- 唯一约束：无
- 迁移建议：首期作为历史数据分析依据，按需迁移

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| QS_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| QS_NAME_CN | VARCHAR(200) | 是 | - |  | 名称 |
| QS_CREATE_TIME | TIMESTAMP(6) | 是 | - |  | 创建时间 |
| QS_CREATE_USER | VARCHAR(64) | 是 | - |  | 创建人 |
| QS_GROUP_COL | CLOB | 是 | - |  | 分组字段 |
| QS_SHOW_COL | CLOB | 是 | - |  | 显示字段 |
| QS_WHERE_COL | CLOB | 是 | - |  | 条件字段 |
| QS_DATEINFO | CLOB | 是 | - |  | 时间设置信息 |
| MT_NAME | VARCHAR(200) | 是 | - |  | 数据表英文名 |
| QS_RESULTLIST | CLOB | 是 | - |  | 结果集 |

#### QUERY_CONDITION

- 表说明：查询条件表
- 主键：`QC_ID`
- 唯一约束：无
- 迁移建议：首期作为历史数据分析依据，按需迁移

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| QC_ID | VARCHAR(64) | 否 | - | 是 | 查询条件表ID |
| QC_TITLE | VARCHAR(50) | 否 | - |  | 查询条件标题 |
| QC_MT_NAME | VARCHAR(100) | 否 | - |  | 所查询表名称 |
| QC_CREATEOR_ID | VARCHAR(64) | 否 | - |  | 创建人 |
| QC_CREATE_TIME | TIMESTAMP(6) | 否 | - |  | 创建时间 |
| QC_CONDITION | CLOB | 是 | - |  | 查询条件 |

### 4.6 数据权限（POWER）

#### POWER_TEMPLATE_ROW

- 表说明：模板行权限
- 主键：`PDR_ID`
- 唯一约束：无
- 迁移建议：首期作为历史数据分析依据，按需迁移

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| PDR_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| PTL_ID | VARCHAR(64) | 是 | - |  | 外键：权限模板ID |
| MT_NAME | VARCHAR(100) | 是 | - |  | 冗余字段：表英文名称 |
| MC_NAME | VARCHAR(100) | 是 | - |  | 列英文名称 |
| PJLDR_CONDITION | VARCHAR(32) | 是 | - |  | 条件 |
| PJLDR_CONTENT | TEXT | 是 | - |  | 内容 |
| PJLDR_LOGIC | VARCHAR(10) | 是 | - |  | 逻辑 |
| MC_DICT_NAME | VARCHAR(100) | 是 | - |  | 对应字典表英文名 |
| PDR_MAN_QUE | INTEGER | 是 | - |  | 管理还是查询 1.管理权限 2.查询权限 |

#### POWER_TEMPLATE_LIMIT

- 表说明：模板权限
- 主键：`PTL_ID`
- 唯一约束：无
- 迁移建议：首期作为历史数据分析依据，按需迁移

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| PTL_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| PT_ID | VARCHAR(64) | 否 | - |  | 模板信息ID |
| MT_NAME | VARCHAR(100) | 是 | - |  | 数据表英文名 |
| PJL_IS_MANAGE | INTEGER | 是 | - |  | 是否有管理权限 0.否 1.是 |
| PJL_IS_QUERY | INTEGER | 是 | - |  | 是否有查询权限 0.否 1.是 |
| PJL_IS_EXPORT | INTEGER | 是 | - |  | 是否能导出 0.否 1.是 |

#### POWER_TEMPLATE_COLUMN

- 表说明：模板列权限
- 主键：`PDC_ID`
- 唯一约束：无
- 迁移建议：首期作为历史数据分析依据，按需迁移

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| PDC_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| PTL_ID | VARCHAR(64) | 是 | - |  | 外键：权限模板ID |
| MT_NAME | VARCHAR(100) | 是 | - |  | 冗余字段：表英文名称 |
| MC_NAME | VARCHAR(100) | 是 | - |  | 列英文名称 |
| PDC_MAN_QUE | INTEGER | 是 | - |  | 管理还是查询 1.管理权限 2.查询权限 |

#### POWER_TEMPLATE

- 表说明：模板信息
- 主键：`PT_ID`
- 唯一约束：无
- 迁移建议：首期作为历史数据分析依据，按需迁移

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| PT_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| PT_NAME | VARCHAR(64) | 是 | - |  | 模板名称 |
| PT_CREATE_TIME | TIMESTAMP(6) | 是 | - |  | 创建时间 |

#### POWER_JOB_LIMIT_TEMP

- 表说明：岗位权限_临时表
- 主键：`PJL_ID`
- 唯一约束：UNIQUE_PJLT(SJ_ID, MT_NAME)
- 迁移建议：首期作为历史数据分析依据，按需迁移

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| PJL_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| SJ_ID | VARCHAR(64) | 是 | - |  | 岗位ID |
| MT_NAME | VARCHAR(100) | 是 | - |  | 数据表英文名 |
| PJL_IS_MANAGE | INTEGER | 是 | - |  | 是否有管理权限 0.否 1.是 |
| PJL_IS_QUERY | INTEGER | 是 | - |  | 是否有查询权限 0.否 1.是 |
| PJL_IS_EXPORT | INTEGER | 是 | - |  | 是否能导出 0.否 1.是 |
| PJL_STATUS | INTEGER | 是 | - |  | 审核状态  0.审核不通过  1.审核中。 如果审核通过了，就删除表中数据。如果审核不通过，状态就改为0，如果再次修改数据，就删除表中所有数据，并且修改的数据状态为1 |

#### POWER_JOB_LIMIT

- 表说明：岗位权限
- 主键：`PJL_ID`
- 唯一约束：无
- 迁移建议：首期作为历史数据分析依据，按需迁移

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| PJL_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| SJ_ID | VARCHAR(64) | 是 | - |  | 岗位ID |
| MT_NAME | VARCHAR(100) | 是 | - |  | 数据表英文名 |
| PJL_IS_MANAGE | INTEGER | 是 | - |  | 是否有管理权限 0.否 1.是 |
| PJL_IS_QUERY | INTEGER | 是 | - |  | 是否有查询权限 0.否 1.是 |
| PJL_IS_EXPORT | INTEGER | 是 | - |  | 是否能导出 0.否 1.是 |

#### POWER_DETAIL_ROW_TEMP

- 表说明：岗位行权限_临时表
- 主键：`PDR_ID`
- 唯一约束：无
- 迁移建议：首期作为历史数据分析依据，按需迁移

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| PDR_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| PJL_ID | VARCHAR(64) | 是 | - |  | 外键：岗位权限ID |
| MT_NAME | VARCHAR(100) | 是 | - |  | 冗余字段：表英文名称 |
| MC_NAME | VARCHAR(100) | 是 | - |  | 列英文名称 |
| PJLDR_CONDITION | VARCHAR(32) | 是 | - |  | 条件 |
| PJLDR_CONTENT | TEXT | 是 | - |  | 内容 |
| PJLDR_LOGIC | VARCHAR(10) | 是 | - |  | 逻辑 |
| MC_DICT_NAME | VARCHAR(100) | 是 | - |  | 对应字典表英文名 |
| PDR_MAN_QUE | INTEGER | 是 | - |  | 管理还是查询 1.管理权限 2.查询权限 |
| PJL_STATUS | INTEGER | 是 | - |  | 审核状态  0.审核不通过  1.审核中。 如果审核通过了，就删除表中数据。如果审核不通过，状态就改为0，如果再次修改数据，就删除表中所有数据，并且修改的数据状态为1 |

#### POWER_DETAIL_ROW

- 表说明：岗位行权限
- 主键：`PDR_ID`
- 唯一约束：无
- 迁移建议：首期作为历史数据分析依据，按需迁移

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| PDR_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| PJL_ID | VARCHAR(64) | 是 | - |  | 外键：岗位权限ID |
| MT_NAME | VARCHAR(100) | 是 | - |  | 冗余字段：表英文名称 |
| MC_NAME | VARCHAR(100) | 是 | - |  | 列英文名称 |
| PJLDR_CONDITION | VARCHAR(32) | 是 | - |  | 条件 |
| PJLDR_CONTENT | TEXT | 是 | - |  | 内容 |
| PJLDR_LOGIC | VARCHAR(10) | 是 | - |  | 逻辑 |
| MC_DICT_NAME | VARCHAR(100) | 是 | - |  | 对应字典表英文名 |
| PDR_MAN_QUE | INTEGER | 是 | - |  | 管理还是查询 1.管理权限 2.查询权限 |

#### POWER_DETAIL_COLUMN_TEMP

- 表说明：岗位列权限_临时表
- 主键：`PDC_ID`
- 唯一约束：无
- 迁移建议：首期作为历史数据分析依据，按需迁移

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| PDC_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| PJL_ID | VARCHAR(64) | 是 | - |  | 外键：岗位权限ID |
| MT_NAME | VARCHAR(100) | 是 | - |  | 冗余字段：表英文名称 |
| MC_NAME | VARCHAR(100) | 是 | - |  | 列英文名称 |
| PDC_MAN_QUE | INTEGER | 是 | - |  | 管理还是查询 1.管理权限 2.查询权限 |
| PJL_STATUS | INTEGER | 是 | - |  | 审核状态  0.审核不通过  1.审核中 。如果审核通过了，就删除表中数据。如果审核不通过，数据状态就改为0，如果再次修改数据，就删除表中所有数据，并且修改的数据为审核状态为1。对内部表而言，查询权限的列的获取规则是：管理权限和查询权限的并集（去重） |

#### POWER_DETAIL_COLUMN

- 表说明：岗位列权限
- 主键：`PDC_ID`
- 唯一约束：无
- 迁移建议：首期作为历史数据分析依据，按需迁移

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| PDC_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| PJL_ID | VARCHAR(64) | 是 | - |  | 外键：岗位权限ID |
| MT_NAME | VARCHAR(100) | 是 | - |  | 冗余字段：表英文名称 |
| MC_NAME | VARCHAR(100) | 是 | - |  | 列英文名称 |
| PDC_MAN_QUE | INTEGER | 是 | - |  | 管理还是查询 1.管理权限 2.查询权限 |

### 4.7 消息管理（MSG）

#### MSG_SEND

- 表说明：消息表
- 主键：`MS_ID`
- 唯一约束：无
- 迁移建议：首期作为历史数据分析依据，按需迁移

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| MS_ID | VARCHAR(64) | 否 | - | 是 | 消息ID |
| MS_TITLE | VARCHAR(200) | 是 | - |  | 标题 |
| MS_CONTENT | CLOB | 是 | - |  | 内容 |
| MS_STATE | NUMERIC(1,0) | 是 | - |  | 状态：0发件箱 1草稿 -1彻底删除 |
| MS_MIDDEN | NUMERIC(1,0) | 是 | - |  | 是否垃圾箱 0正常 -1垃圾箱 |
| MS_USER | VARCHAR(50) | 是 | - |  | 创建用户 |
| MS_SIZE | VARCHAR(20) | 是 | - |  | 邮件内容大小 |
| CREATE_TIME | TIMESTAMP(6) | 是 | - |  | 创建时间 |
| MODIFIY_TIME | TIMESTAMP(6) | 是 | - |  | 修改时间 |

#### MSG_LINKMAN

- 表说明：邮件常用联系人
- 主键：`ML_ID`
- 唯一约束：无
- 迁移建议：首期作为历史数据分析依据，按需迁移

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| ML_ID | VARCHAR(64) | 否 | - | 是 | 常用联系人ID |
| MS_USER | VARCHAR(64) | 是 | - |  | 发件人ID |
| MG_USER | VARCHAR(300) | 是 | - |  | 收件人ID |
| ML_STAT | DEC(10,0) | 是 | - |  | 发件次数 |

#### MSG_GET

- 表说明：收件表
- 主键：`MG_ID`
- 唯一约束：无
- 迁移建议：首期作为历史数据分析依据，按需迁移

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| MG_ID | VARCHAR(64) | 否 | - | 是 | 收件ID |
| MS_ID | VARCHAR(64) | 是 | - |  | 消息ID |
| MG_USER | VARCHAR(64) | 是 | - |  | 收件人ID |
| MG_STATE | NUMERIC(1,0) | 是 | - |  | 状态：0发件箱 -1彻底删除 |
| MG_MIDDEN | NUMERIC(1,0) | 是 | - |  | 是否垃圾箱：0正常 -1垃圾箱 |
| MG_READ | NUMERIC(1,0) | 是 | - |  | 阅读状态 0未读，1已读 |
| MG_TIME | TIMESTAMP(6) | 是 | - |  | 接收时间 |

#### MSG_FILE

- 表说明：附件表
- 主键：`MF_ID`
- 唯一约束：无
- 迁移建议：首期作为历史数据分析依据，按需迁移

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| MF_ID | VARCHAR(64) | 否 | - | 是 | 附件ID |
| MS_ID | VARCHAR(64) | 是 | - |  | 消息ID |
| MF_FILE | BLOB | 是 | - |  | 文件 |
| MF_NAME | VARCHAR(100) | 是 | - |  | 名称 |
| MF_SIZE | VARCHAR(20) | 是 | - |  | 大小 |

### 4.8 元数据管理（META）

#### META_TABLE_TYPE

- 表说明：表分类
- 主键：`MTT_ID`
- 唯一约束：无
- 迁移建议：映射至目标态核心元数据模型

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| MTT_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| MTT_NAME | VARCHAR(100) | 是 | - |  | 分类名称 |
| MTT_PARENT_ID | VARCHAR(64) | 是 | - |  | 上级分类 |
| MTT_LEVEL | VARCHAR(2000) | 是 | - |  | 层级 |
| MTT_ORDER | INTEGER | 是 | - |  | 排序号 |
| MTT_CREATE_TIME | TIMESTAMP(6) | 是 | - |  | 创建时间 |

#### META_TABLE_RELATION_DETAIL

- 表说明：表关联详细
- 主键：`MTRD_ID`
- 唯一约束：无
- 迁移建议：映射至目标态核心元数据模型

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| MTRD_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| MTR_ID | VARCHAR(64) | 否 | - |  | 对应关联 |
| MT_NAME_A | VARCHAR(100) | 是 | - |  | A表 |
| MT_NAME_B | VARCHAR(100) | 是 | - |  | B表 |

#### META_TABLE_RELATION

- 表说明：表关联关系
- 主键：`MTR_ID`
- 唯一约束：无
- 迁移建议：映射至目标态核心元数据模型

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| MTR_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| MTR_NAME | VARCHAR(100) | 是 | - |  | 关联名称 |
| MTR_XML | CLOB | 是 | - |  | MXGRAPH图形XML |
| MTR_CREATE_TIME | DATETIME(6) | 是 | - |  | 创建时间 |
| MTR_REMARK | VARCHAR(500) | 是 | - |  | 备注 |

#### META_TABLE_PARTITION

- 表说明：分表
- 主键：`MTP_ID`
- 唯一约束：CONS134219012(MTP_NAME)
- 迁移建议：映射至目标态核心元数据模型

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| MTP_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| MT_NAME | VARCHAR(100) | 是 | - |  | 对应主表表英文名 |
| MTP_NAME | VARCHAR(100) | 是 | - |  | 分表表英文名 |
| MTP_COUNT | NUMERIC(16,0) | 是 | - |  | 分表记录数 |
| MTP_CREATE_TIME | TIMESTAMP(6) | 是 | - |  | 创建时间 |
| MTP_IS_ES_INDEX | INTEGER | 是 | - |  | 是否建全文索引(0否 1是) |

#### META_TABLE_INHERIT

- 表说明：继承项设置表
- 主键：`MTI_ID`
- 唯一约束：无
- 迁移建议：映射至目标态核心元数据模型

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| MTI_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| SU_ID | VARCHAR(64) | 是 | - |  | 用户ID |
| MT_NAME | VARCHAR(64) | 是 | - |  | 元数据表英文名称 |
| MC_NAME | VARCHAR(64) | 是 | - |  | 列英文名称 |

#### META_TABLE_INCREASE

- 表说明：每日增量总数表
- 主键：`MTI_ID`
- 唯一约束：无
- 迁移建议：映射至目标态核心元数据模型

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| MTI_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| MT_NAME | VARCHAR(100) | 是 | - |  | 表名称 |
| MTI_INCREASE | NUMERIC(18,0) | 是 | - |  | 当日总数 |
| MTI_COUNT | NUMERIC(18,0) | 是 | - |  | - |
| MTI_CREATE_TIME | TIMESTAMP(6) | 是 | - |  | 创建时间 |

#### META_TABLE

- 表说明：元数据表
- 主键：`MT_ID`
- 唯一约束：CONS134219009(MT_NAME)
- 迁移建议：映射至目标态核心元数据模型

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| MT_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| MT_NAME_CN | VARCHAR(100) | 是 | - |  | 表中文名 |
| MT_NAME | VARCHAR(100) | 是 | - |  | 表英文名 |
| MTT_ID | VARCHAR(64) | 是 | - |  | 所属分类(外键) |
| MT_TYPE | INTEGER | 是 | - |  | 数据表类型(1.主表 2.子表 3.字典表 ) |
| MT_IS_TREE | INTEGER | 是 | - |  | 是否树形(0否 1是) |
| MT_IS_INNER | INTEGER | 是 | - |  | 是否内部表(0否 1是) |
| MT_IS_PUBLIC | INTEGER | 是 | - |  | 是否公有(0否 1是) |
| SU_ID | VARCHAR(64) | 是 | - |  | 创建人 |
| MT_CREATE_TIME | TIMESTAMP(6) | 是 | - |  | 创建时间 |
| MT_ORDER | INTEGER | 是 | - |  | 排序号 |
| MT_COUNT | NUMERIC | 是 | - |  | 记录总数 |
| MT_PARENT_NAME | VARCHAR(100) | 是 | - |  | 父表英文名称 |
| MT_IS_ES_INDEX | INTEGER | 是 | - |  | 是否建全文索引(0否 1是) |
| MT_ICON | VARCHAR(200) | 是 | - |  | 表图标样式 |

#### META_GROUP_MUST

- 表说明：分组必填表
- 主键：`MGM_ID`
- 唯一约束：无
- 迁移建议：映射至目标态核心元数据模型

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| MGM_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| MT_NAME | VARCHAR(100) | 是 | - |  | 表名称 |
| MGM_CONTENT | VARCHAR(1000) | 是 | - |  | 列集合 |
| MGM_COLOR | VARCHAR(10) | 是 | - |  | 代表颜色 |

#### META_FACTOR_DETAIL

- 表说明：应用系统表(SP)
- 主键：`MFD_ID`
- 唯一约束：无
- 迁移建议：映射至目标态核心元数据模型

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| MFD_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| MF_ID | VARCHAR(64) | 是 | - |  | 码址ID |
| MT_NAME | VARCHAR(100) | 是 | - |  | 数据表英文名 |
| MC_NAME | VARCHAR(100) | 是 | - |  | 列英文名 |

#### META_FACTOR

- 表说明：码址表
- 主键：`MF_ID`
- 唯一约束：无
- 迁移建议：映射至目标态核心元数据模型

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| MF_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| MF_NAME | VARCHAR(100) | 是 | - |  | 名称 |
| SU_ID | VARCHAR(64) | 是 | - |  | 创建人 |
| MF_CREATE_TIME | TIMESTAMP(6) | 是 | - |  | 创建时间 |

#### META_DATA_RELATION

- 表说明：数据关联
- 主键：`MDR_ID`
- 唯一约束：无
- 迁移建议：映射至目标态核心元数据模型

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| MDR_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| MTR_ID | VARCHAR(64) | 否 | - |  | 对应表关联关系主键 |
| MT_NAME_A | VARCHAR(100) | 是 | - |  | A表表英文名 |
| DM_PK_A | VARCHAR(64) | 否 | - |  | A表数据ID |
| MT_NAME_B | VARCHAR(100) | 是 | - |  | B表表英文名 |
| DM_PK_B | VARCHAR(64) | 否 | - |  | B表数据ID |

#### META_DATA_MODIFY_LOG

- 表说明：数据修改记录
- 主键：`MDML_ID`
- 唯一约束：无
- 迁移建议：映射至目标态核心元数据模型

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| MDML_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| DM_PK | VARCHAR(64) | 是 | - |  | 被修改记录ID |
| MT_NAME | VARCHAR(100) | 是 | - |  | 数据表英文名称 |
| MC_NAME | VARCHAR(100) | 是 | - |  | 字段英文名称 |
| SU_ID | VARCHAR(64) | 是 | - |  | 操作用户ID |
| SO_ID | VARCHAR(64) | 是 | - |  | 操作部门ID |
| SJ_ID | VARCHAR(64) | 是 | - |  | 操作岗位ID |
| MDML_MODIFY_TIME | TIMESTAMP(6) | 是 | SYSDATE() |  | 操作时间 |
| MDML_IP | VARCHAR(30) | 是 | - |  | IP地址 |
| MDML_MODIFY_BEFORE | VARCHAR(800) | 是 | - |  | 修改前内容 |
| MDML_MODIFY_AFTER | VARCHAR(800) | 是 | - |  | 修改后内容 |
| MDML_MODIFY_REASON | VARCHAR(800) | 是 | - |  | 修改原因 |

#### META_COLUMNWEIGHT

- 表说明：权重分数表
- 主键：`MCW_ID`
- 唯一约束：无
- 迁移建议：映射至目标态核心元数据模型

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| MCW_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| MCW_ORDER | INTEGER | 否 | - |  | 序号 |
| MCW_NAME | VARCHAR(100) | 是 | - |  | 权重名称 |
| MCW_SCORE | INTEGER | 是 | - |  | 权重分值 |

#### META_COLUMN

- 表说明：字段信息
- 主键：`MC_ID`
- 唯一约束：无
- 迁移建议：映射至目标态核心元数据模型

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| MC_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| MT_NAME | VARCHAR(100) | 是 | - |  | 所属表(外键) |
| MC_NAME_CN | VARCHAR(100) | 是 | - |  | 中文名 |
| MC_NAME | VARCHAR(100) | 是 | - |  | 英文名 |
| MC_TYPE | VARCHAR(10) | 是 | - |  | 类型 |
| MC_LENGTH | INTEGER | 是 | - |  | 长度 |
| MC_PRECISION | INTEGER | 是 | - |  | 精度 |
| MC_IS_REQUIRED | INTEGER | 是 | - |  | 是否必填(0否 1是) |
| MC_DICT_NAME | VARCHAR(100) | 是 | - |  | 对应字典表英文名 |
| MC_DICT_IS_TREE | INTEGER | 是 | - |  | 对应字典表是平行表，还是树形表(NULL非字典列即MC_DICT_NAME为空，0否， 1是， 2是业务表) |
| MC_IS_TREE_DISPLAY | INTEGER | 是 | - |  | 是否树形展示列(0否 1是) |
| MC_WEIGHT | INTEGER | 是 | - |  | 权重 |
| MC_IS_PINYIN | INTEGER | 是 | - |  | 是否拼音列(0否 1是) |
| MC_ORDER | INTEGER | 是 | - |  | 排序号 |
| MC_IS_MULTIPLE | INTEGER | 是 | '0' |  | 对应字典是否多选(0否1是) |
| MC_COLUMN_NAME_CN | VARCHAR(100) | 是 | - |  | 标识业务字典字段的显示列 |

### 4.9 检索与索引（JS）

#### JS_THREAD

- 表说明：建索引状态表
- 主键：`JT_ID`
- 唯一约束：无
- 迁移建议：首期作为历史数据分析依据，按需迁移

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| JT_ID | VARCHAR(32) | 否 | - | 是 | ID |
| JT_STATUS | INTEGER | 是 | - |  | 增加或修改线程数量 |

#### js_table_task

- 表说明：数据表采集任务
- 主键：`jtt_id`
- 唯一约束：无
- 迁移建议：首期作为历史数据分析依据，按需迁移

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| jtt_id | VARCHAR(64) | 否 | - | 是 | 主键 |
| jtt_table_id | VARCHAR(64) | 是 | - |  | 表主键 |
| jtt_table_name | VARCHAR(400) | 是 | - |  | 表名称 |
| jtt_max_rowid | VARCHAR(500) | 是 | - |  | 上次采集数据位置 |
| jtt_status | INTEGER | 是 | 0 |  | - |

#### js_key_count

- 表说明：用户搜索关键字统计
- 主键：`jkc_id`
- 唯一约束：无
- 迁移建议：首期作为历史数据分析依据，按需迁移

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| jkc_id | VARCHAR(64) | 否 | - | 是 | 主键 |
| jkc_key | VARCHAR(1000) | 是 | - |  | 关键字 |
| jkc_search_user | VARCHAR(200) | 是 | - |  | 操作用户 |
| jkc_type | VARCHAR(20) | 是 | - |  | 操作类型:　doc文档， db数据库 |
| jkc_time | TIMESTAMP(6) | 是 | - |  | 操作时间 |

#### JS_DOCUMENT_INDEX

- 表说明：文件索引表
- 主键：`JDI_ID`
- 唯一约束：无
- 迁移建议：首期作为历史数据分析依据，按需迁移

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| JDI_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| JDI_NAME | VARCHAR(200) | 是 | - |  | 索引名称 |
| JDI_REMARK | VARCHAR(1000) | 是 | - |  | 备注 |
| JDI_DIR_ID | VARCHAR(320) | 是 | - |  | 所属目录ID |
| JDI_DIR_NAME | VARCHAR(1000) | 是 | - |  | 所属目录名称 |
| JDI_DIR_PATH | BLOB | 是 | - |  | 路径 |
| JDI_FILE_NUM | NUMBER | 是 | - |  | 文件数量 |
| JDI_FILE_SIZE | NUMBER | 是 | - |  | 文件大小 |
| JDI_CREATE_PERSON | VARCHAR(200) | 是 | - |  | 创建人 |
| JDI_CREATE_TIME | TIMESTAMP(6) | 是 | - |  | 创建时间 |

#### js_dir_user

- 表说明：目录用户授权
- 主键：`jdu_id`
- 唯一约束：无
- 迁移建议：首期作为历史数据分析依据，按需迁移

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| jdu_id | VARCHAR(64) | 否 | - | 是 | 主键 |
| jdu_jd_id | VARCHAR(64) | 是 | - |  | 目录主键 |
| jdu_su_id | VARCHAR(64) | 是 | - |  | 用户主键 |
| jdu_status | INTEGER | 是 | - |  | 状态（0等审核、1审核通过、2审核不通过） |
| jdu_action | VARCHAR(50) | 是 | - |  | 动作 |

#### js_dir

- 表说明：索引目录
- 主键：`jd_id`
- 唯一约束：无
- 迁移建议：首期作为历史数据分析依据，按需迁移

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| jd_id | VARCHAR(64) | 否 | - | 是 | 主键 |
| jd_name | VARCHAR(500) | 是 | - |  | 目录名称 |
| jd_create_user | VARCHAR(64) | 是 | - |  | 创建人 |
| jd_create_time | TIMESTAMP(6) | 是 | - |  | 创建时间 |
| jd_parent_id | VARCHAR(64) | 是 | - |  | 父目录 |
| jd_status | INT | 是 | - |  | 状态（0等审核、1审核通过、2审核不通过） |

#### js_column_task

- 表说明：数据表采集任务列信息
- 主键：`jct_id`
- 唯一约束：无
- 迁移建议：首期作为历史数据分析依据，按需迁移

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| jct_id | VARCHAR(64) | 否 | - | 是 | 主键 |
| jct_column_id | VARCHAR(64) | 是 | - |  | 列主键 |
| jct_column_name | VARCHAR(100) | 是 | - |  | 列名 |
| jct_column_type | VARCHAR(20) | 是 | - |  | 列类型 |
| jct_column_length | INTEGER | 是 | - |  | 列长度 |
| jct_column_precision | INTEGER | 是 | - |  | 列精度 |
| jct_table_id | VARCHAR(64) | 是 | - |  | 列所属表主键 |
| jct_table_name | VARCHAR(100) | 是 | - |  | 列所属表表名 |
| jct_type | VARCHAR(50) | 是 | - |  | 索引显示类型 |
| mc_dict_name | VARCHAR(100) | 是 | - |  | - |
| mc_dict_column | VARCHAR(100) | 是 | - |  | - |
| mc_dict_display | VARCHAR(100) | 是 | - |  | - |
| mc_is_multiple | INTEGER | 是 | 0 |  | - |

### 4.10 数据比对（COMPARE）

#### COMPARE_LAST_ROWID

- 表说明：记录外部表上一次比对数据最后rowid
- 主键：`CLR_ID`
- 唯一约束：无
- 迁移建议：首期作为历史数据分析依据，按需迁移

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| CLR_ID | VARCHAR(32) | 否 | - | 是 | 主键 |
| C_ID | VARCHAR(64) | 是 | - |  | 比对主键 |
| MT_NAME | VARCHAR(500) | 是 | - |  | 表名 |
| LAST_ROW_ID | VARCHAR(200) | 是 | - |  | rowid |
| LAST_RUN_TIME | TIMESTAMP(6) | 是 | - |  | 最后运行时间 |

#### COMPARE_FILECOMPARERESULTS

- 表说明：SQL 未提供表注释
- 主键：`CFR_ID`
- 唯一约束：无
- 迁移建议：首期作为历史数据分析依据，按需迁移

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| CFR_ID | VARCHAR(64) | 否 | - | 是 | - |
| CF_ID | VARCHAR(64) | 否 | - |  | - |
| CF_CREATE_TIME | TIMESTAMP(6) | 是 | - |  | - |
| CF_RESULTLIST | CLOB | 是 | - |  | - |
| CF_COUNT | NUMERIC(16,0) | 是 | - |  | - |
| CF_ISVIEW | INTEGER | 是 | - |  | - |

#### COMPARE_FILECOMPARE

- 表说明：文件比对对象
- 主键：`CF_ID`
- 唯一约束：无
- 迁移建议：首期作为历史数据分析依据，按需迁移

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| CF_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| CF_NAME | VARCHAR(200) | 是 | - |  | 名称 |
| CF_WHEREMAP | CLOB | 是 | - |  | where条件JSON格式 |
| CF_CONDITION | VARCHAR(10) | 是 | - |  | 比对条件 |
| CF_RELATION | VARCHAR(10) | 是 | - |  | - |
| MT_NAMES | VARCHAR(500) | 是 | - |  | - |
| MF_IDS | VARCHAR(500) | 是 | - |  | - |
| CF_START_DATE | TIMESTAMP(6) | 是 | - |  | 开始时间 |
| CF_END_DATE | TIMESTAMP(6) | 是 | - |  | 结束时间 |
| CF_INTERVAL | INTEGER | 是 | - |  | 间隔时间 |
| CF_UNIT | INTEGER | 是 | - |  | 间隔单位 |
| CF_STATUS | INTEGER | 是 | - |  | 状态 0未运行1正在运行2运行完成3运行出错 |
| CF_LAST_RUNTIME | TIMESTAMP(6) | 是 | - |  | 上次运行时间 |
| CF_COUNT | NUMERIC(16,0) | 是 | - |  | 命中数 |
| CF_FILENAME | VARCHAR(300) | 是 | - |  | 文件名 |
| CF_FILE | BLOB | 是 | - |  | 文件 |
| CF_CREATE_TIME | TIMESTAMP(6) | 是 | - |  | 创建时间 |
| CF_CREATE_USER | VARCHAR(64) | 是 | - |  | 创建人 |
| SJ_ID | VARCHAR(64) | 是 | - |  | 岗位ID |
| CF_RESULTLIST | CLOB | 是 | - |  | 缓存结果集字段 |

#### COMPARE_EXCEL_TO_EXCEL

- 表说明：外部数据比对
- 主键：`CE_ID`
- 唯一约束：无
- 迁移建议：首期作为历史数据分析依据，按需迁移

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| CE_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| CE_FILENAME1 | VARCHAR(300) | 是 | - |  | Excel文件1名称 |
| CE_FILENAME1_STATE | VARCHAR(2) | 是 | - |  | Excel文件1状态 |
| CE_FILENAME2_STATE | VARCHAR(2) | 是 | - |  | Excel文件2状态 |
| CE_FILENAME2 | VARCHAR(300) | 是 | - |  | Excel文件2名称 |
| CE_FILENAME1_BLOB | BLOB | 是 | - |  | Excel文件1 |
| CE_FILENAME2_BLOB | BLOB | 是 | - |  | Excel文件2 |
| CE_RELATED_COLUMNS | CLOB | 是 | - |  | 关联字段 |
| CE_SHOW_COLUMNS1 | CLOB | 是 | - |  | 显示字段 |
| CE_SHOW_COLUMNS2 | CLOB | 是 | - |  | 显示字段 |
| MT_NAME1 | VARCHAR(100) | 是 | - |  | Excel文件1生成的表1 |
| MT_NAME2 | VARCHAR(100) | 是 | - |  | Excel文件2生成的表2 |
| CE_CREATE_TIME | TIMESTAMP(6) | 是 | - |  | 创建时间 |
| CE_CREATE_USER | VARCHAR(64) | 是 | - |  | 创建用户 |

#### COMPARE_DATACOMPARE

- 表说明：库间比对对象
- 主键：`CD_ID`
- 唯一约束：无
- 迁移建议：首期作为历史数据分析依据，按需迁移

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| CD_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| CD_NAME | VARCHAR(200) | 是 | - |  | 名称 |
| CD_WHEREMAP | CLOB | 是 | - |  | where条件JSON格式 |
| CD_CONDITION | VARCHAR(10) | 是 | - |  | 比对条件 |
| CD_RELATION | VARCHAR(10) | 是 | - |  | - |
| MT_NAMES | VARCHAR(500) | 是 | - |  | - |
| MF_IDS | VARCHAR(500) | 是 | - |  | - |
| CD_START_DATE | TIMESTAMP(6) | 是 | - |  | 开始时间 |
| CD_END_DATE | TIMESTAMP(6) | 是 | - |  | 结束时间 |
| CD_INTERVAL | INTEGER | 是 | - |  | 间隔时间 |
| CD_UNIT | INTEGER | 是 | - |  | 间隔单位 |
| CD_STATUS | INTEGER | 是 | - |  | 状态 0未运行1正在运行2运行完成3运行出错 |
| CD_LAST_RUNTIME | TIMESTAMP(6) | 是 | - |  | 上次运行时间 |
| CD_COUNT | NUMERIC(16,0) | 是 | - |  | 命中数 |
| MT_NAME | VARCHAR(100) | 是 | - |  | 数据表名 |
| CD_WHERE | CLOB | 是 | - |  | 过滤条件 |
| CD_CREATE_TIME | TIMESTAMP(6) | 是 | - |  | 创建时间 |
| CD_CREATE_USER | VARCHAR(64) | 是 | - |  | 创建人 |
| SJ_ID | VARCHAR(64) | 是 | - |  | 岗位ID |
| CD_RESULTLIST | CLOB | 是 | - |  | 缓存结果集字段 |

### 4.11 业务任务（BUSINESS）

#### BUSINESS_TASK_LIST

- 表说明：任务分解表
- 主键：`BTL_ID`
- 唯一约束：无
- 迁移建议：首期作为历史数据分析依据，按需迁移

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| BTL_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| BT_ID | VARCHAR(64) | 是 | - |  | 所属任务 |
| BTL_CONTENT | CLOB | 是 | - |  | 内容 |
| BTL_STATE | VARCHAR(2) | 是 | - |  | 状态 |
| BTL_REPLY | VARCHAR(2) | 是 | - |  | 是否反馈 |
| BTL_ORDER | NUMBER(10,0) | 是 | - |  | 排序号 |
| BTL_SO_ID | VARCHAR(64) | 是 | - |  | 处理单位 |
| BTL_SU_ID | VARCHAR(2000) | 是 | - |  | 处理人 |
| BTL_VIEW_STATE | VARCHAR(2) | 是 | - |  | 处理人查看状态 |
| BTL_VIEW_USER | VARCHAR(64) | 是 | - |  | 接收人 |
| BTL_VIEW_TIME | TIMESTAMP(6) | 是 | - |  | 接收时间 |

#### BUSINESS_TASK

- 表说明：任务表
- 主键：`BT_ID`
- 唯一约束：无
- 迁移建议：首期作为历史数据分析依据，按需迁移

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| BT_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| BC_ID | VARCHAR(64) | 是 | - |  | 业务类型 |
| BT_TITLE | VARCHAR(200) | 是 | - |  | 标题 |
| BT_CONTENT | CLOB | 是 | - |  | 内容 |
| BT_ATTRIBUTE | CLOB | 是 | - |  | 其他业务要素 |
| BT_BEGIN_TIME | TIMESTAMP(6) | 是 | - |  | 任务开始时间 |
| BT_END_TIME | TIMESTAMP(6) | 是 | - |  | 任务结束时间 |
| BT_CREATE_SOID | VARCHAR(64) | 是 | - |  | - |
| BT_CREATE_USER | VARCHAR(64) | 是 | - |  | 创建人 |
| BT_CREATE_TIME | TIMESTAMP(6) | 是 | - |  | 创建时间 |
| BT_STATE | VARCHAR(10) | 是 | - |  | 状态 |
| SO_ID | VARCHAR(2000) | 是 | - |  | 处理单位 |
| SU_ID | VARCHAR(2000) | 是 | - |  | 处理人 |
| BT_FILE | BLOB | 是 | - |  | 附件 |
| BT_FILENAME | VARCHAR(320) | 是 | - |  | 附件名称 |
| BT_HAS_ITEM | VARCHAR(2) | 是 | - |  | 是否有分解任务 |

#### BUSINESS_REPLY

- 表说明：任务完成反馈表
- 主键：**无主键**
- 唯一约束：无
- 迁移建议：首期作为历史数据分析依据，按需迁移

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| BR_ID | VARCHAR(64) | 否 | - |  | 主键 |
| BT_HAS_ITEM | VARCHAR(2) | 是 | - |  | 是否分解任务 |
| BTL_ID | VARCHAR(64) | 是 | - |  | 任务分解ID |
| BR_CONTENT | CLOB | 是 | - |  | 完成内容 |
| BR_FILE | BLOB | 是 | - |  | 附件 |
| BR_FILE_BLOB | VARCHAR(200) | 是 | - |  | 附件名称 |
| BR_PERSON | VARCHAR(200) | 是 | - |  | 填写人 |
| BR_VIEW_STATE | VARCHAR(2) | 是 | - |  | 反馈查看状态 |
| BR_BACK_CONTENT | CLOB | 是 | - |  | 回复内容 |
| BR_BACK_VIEW_STATE | VARCHAR(2) | 是 | - |  | 回复查看状态 |
| BR_TIME | TIMESTAMP(6) | 是 | - |  | 完成时间 |
| BR_STATE | VARCHAR(2) | 是 | - |  | 反馈状态 |
| BR_REMARK | VARCHAR(500) | 是 | - |  | 备注 |

#### BUSINESS_CATEGORY

- 表说明：业务类型表
- 主键：`BC_ID`
- 唯一约束：无
- 迁移建议：首期作为历史数据分析依据，按需迁移

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| BC_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| BC_NAME | VARCHAR(100) | 是 | - |  | 类型名称 |
| BC_DESC | VARCHAR(500) | 是 | - |  | 类型描述 |

#### BUSINESS_ATTRIBUTE

- 表说明：业务要素
- 主键：`BA_ID`
- 唯一约束：无
- 迁移建议：首期作为历史数据分析依据，按需迁移

| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |
|---|---|:---:|---|:---:|---|
| BA_ID | VARCHAR(64) | 否 | - | 是 | 主键 |
| BC_ID | VARCHAR(64) | 是 | - |  | 所属业务类型 |
| BA_NAME | VARCHAR(100) | 是 | - |  | 要素名称 |
| BA_TYPE | VARCHAR(64) | 是 | - |  | 要素类型 |
| BA_DICT | VARCHAR(64) | 是 | - |  | 对应字典表 |
| BA_ORDER | DEC(10,0) | 是 | - |  | 排序号 |
| BA_REQUIRED | VARCHAR(2) | 是 | - |  | 是否必填 |

## 5. 旧新模型映射原则

| 旧模块 | 首期处理 | 目标态去向 |
|---|---|---|
| META_* | 选择性迁移 | catalogs、schemas、meta_tables、meta_columns、relations、tags |
| SYS_* | 语义迁移 | users、roles、permissions 及关联表；密码不得原样迁移 |
| RULE_* | 转换迁移 | 可表达为质量检查的规则进入 quality_rules，其余形成未迁移报告 |
| QUERY_* | 按需迁移 | 可转换的个人查询进入 saved_queries |
| POWER_* | 不直接迁移 | 首期仅保留功能权限；复杂行列权限列入后续版本 |
| JS_* | 不直接迁移 | 由 SQLite FTS5 与新采集任务替代 |
| COMPARE_* | 暂不迁移 | 后续数据比对模块扩展 |
| WEB_* / MSG_* / BUSINESS_* | 暂不迁移 | 不属于首期元数据核心闭环 |

## 6. 数据质量与结构风险

- 旧库无显式外键，引用完整性只能通过同名 ID、注释和种子数据推断。
- 个别表缺少主键，导入时必须生成稳定对象标识并记录来源行定位。
- 类型混用 `DEC`、`NUMBER`、`INT`、`INTEGER`、`CLOB`、`BLOB`，必须同时保存原始类型和标准化类型。
- 大量状态字段使用字符串或整数但缺少 CHECK 约束，迁移前需从种子数据归纳枚举并人工确认。
- 旧表命名存在大小写和拼写不一致，解析及映射必须大小写不敏感，展示时保留原名。
- 初始化数据可能包含账号、组织及业务信息；导入报告默认只输出统计，不复制敏感值。
