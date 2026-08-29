import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MetadataDatabase } from "../dist/main/database.js";
import { MetadataManagementRepository } from "../dist/main/management.js";
import { DataSourceRepository } from "../dist/main/sources.js";

const databasePath =
  process.env.DATAMAKER_DB_PATH ??
  join(process.env.APPDATA ?? "", "DataMaker", "datamaker.db");
const dataDirectory = dirname(databasePath);
const sourcePath = join(dataDirectory, "datamaker-demo-source.db");
mkdirSync(dataDirectory, { recursive: true });

const sourceDatabase = new DatabaseSync(sourcePath);
sourceDatabase.exec(`
  PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS PERSON_PROFILE (
    ID INTEGER PRIMARY KEY, NAME TEXT NOT NULL, GENDER TEXT, BIRTHDAY TEXT,
    CTFID TEXT UNIQUE, MOBILE TEXT, EMAIL TEXT, ADDRESS TEXT
  );
  CREATE TABLE IF NOT EXISTS HOTEL_RECORD (
    ID INTEGER PRIMARY KEY, PERSON_ID INTEGER NOT NULL REFERENCES PERSON_PROFILE(ID),
    HOTEL_NAME TEXT NOT NULL, CHECK_IN_TIME TEXT NOT NULL, ROOM_NO TEXT
  );
  CREATE TABLE IF NOT EXISTS CASE_EVENT (
    ID INTEGER PRIMARY KEY, PERSON_ID INTEGER REFERENCES PERSON_PROFILE(ID),
    EVENT_TYPE TEXT NOT NULL, EVENT_TIME TEXT NOT NULL, DESCRIPTION TEXT
  );
  INSERT OR IGNORE INTO PERSON_PROFILE VALUES
    (1,'张三','男','1988-03-12','110101198803120011','13800000001','zhangsan@example.com','北京市东城区'),
    (2,'李四','女','1992-07-21','110101199207210022','13800000002','lisi@example.com','北京市海淀区'),
    (3,'王五','男','1985-11-06','110101198511060033','13800000003','wangwu@example.com','上海市浦东新区');
  INSERT OR IGNORE INTO HOTEL_RECORD VALUES
    (1,1,'示例酒店A','2026-08-26 20:15:00','0808'),
    (2,2,'示例酒店B','2026-08-27 18:30:00','1206'),
    (3,1,'示例酒店C','2026-08-28 22:10:00','0512');
  INSERT OR IGNORE INTO CASE_EVENT VALUES
    (1,1,'线索','2026-08-27 09:00:00','旧库业务事件模拟记录'),
    (2,3,'核查','2026-08-28 14:30:00','待核查的模拟事件');
`);
sourceDatabase.close();

const database = new MetadataDatabase(databasePath);
try {
  const sources = new DataSourceRepository(database.db);
  const management = new MetadataManagementRepository(database.db);
  let source = sources
    .list()
    .find((item) => item.name === "Legacy Demo SQLite");
  source = sources.save({
    id: source?.id,
    name: "Legacy Demo SQLite",
    type: "sqlite",
    filePath: sourcePath,
  });
  const scan = sources.scan(source.id);

  const ensure = (module, match, values) => {
    const existing = management.list(module).find(match);
    return management.save(module, { id: existing?.id, values });
  };
  const root = ensure("categories", (item) => item.name === "示例业务数据", {
    name: "示例业务数据",
    display_order: 10,
  });
  const personCategory = ensure(
    "categories",
    (item) => item.name === "人员信息",
    { name: "人员信息", parent_id: root.id, display_order: 1 },
  );
  const eventCategory = ensure(
    "categories",
    (item) => item.name === "事件记录",
    { name: "事件记录", parent_id: root.id, display_order: 2 },
  );

  for (const [name, score, order] of [
    ["一般字段", 20, 1],
    ["检索字段", 60, 2],
    ["关键字段", 100, 3],
  ])
    ensure("weights", (item) => item.name === name, {
      name,
      score,
      display_order: order,
    });

  const gender = ensure(
    "dictionaryDefinitions",
    (item) => item.code === "GENDER",
    {
      name: "性别",
      code: "GENDER",
      dictionary_type: "list",
      created_by: "demo",
    },
  );
  for (const [value, order] of [
    ["男", 1],
    ["女", 2],
    ["未知", 3],
  ])
    ensure(
      "dictionaryValues",
      (item) => item.dictionary_id === gender.id && item.value === value,
      { dictionary_id: gender.id, value, display_order: order },
    );

  const region = ensure(
    "dictionaryDefinitions",
    (item) => item.code === "REGION",
    {
      name: "行政区域",
      code: "REGION",
      dictionary_type: "tree",
      created_by: "demo",
    },
  );
  const beijing = ensure(
    "dictionaryValues",
    (item) => item.dictionary_id === region.id && item.value === "北京市",
    { dictionary_id: region.id, value: "北京市", display_order: 1 },
  );
  ensure(
    "dictionaryValues",
    (item) => item.dictionary_id === region.id && item.value === "海淀区",
    {
      dictionary_id: region.id,
      value: "海淀区",
      parent_id: beijing.id,
      display_order: 1,
    },
  );

  const metadataTables = database.db
    .prepare("SELECT id,name FROM meta_tables WHERE retired=0")
    .all();
  const metadataId = (name) =>
    metadataTables.find((item) => item.name === name)?.id ?? null;
  const person = ensure("tables", (item) => item.name === "PERSON_PROFILE", {
    name: "PERSON_PROFILE",
    display_name: "人员基本信息",
    category_id: personCategory.id,
    source_table_id: metadataId("PERSON_PROFILE"),
    table_type: "business",
    is_internal: true,
    is_public: true,
    row_count: 3,
    is_search_indexed: true,
    description: "依据旧 META_TABLE / META_COLUMN 模拟",
    columns_json: JSON.stringify([
      {
        name: "ID",
        display_name: "主键",
        data_type: "number",
        is_primary_key: true,
        show_in_list: true,
      },
      {
        name: "NAME",
        display_name: "姓名",
        data_type: "varchar",
        length: 200,
        searchable: true,
        title_column: true,
      },
      {
        name: "GENDER",
        display_name: "性别",
        data_type: "varchar",
        length: 20,
        dictionary_name: "GENDER",
        show_in_list: true,
      },
      {
        name: "CTFID",
        display_name: "证件号",
        data_type: "varchar",
        length: 32,
        searchable: true,
      },
      {
        name: "MOBILE",
        display_name: "手机",
        data_type: "varchar",
        length: 32,
        searchable: true,
      },
    ]),
  });
  const hotel = ensure("tables", (item) => item.name === "HOTEL_RECORD", {
    name: "HOTEL_RECORD",
    display_name: "住宿记录",
    category_id: eventCategory.id,
    source_table_id: metadataId("HOTEL_RECORD"),
    table_type: "business",
    is_internal: false,
    is_public: true,
    row_count: 3,
    description: "DATA_HOTEL 场景模拟",
    columns_json: JSON.stringify([
      {
        name: "ID",
        display_name: "主键",
        data_type: "number",
        is_primary_key: true,
      },
      {
        name: "PERSON_ID",
        display_name: "人员ID",
        data_type: "number",
        searchable: true,
      },
      {
        name: "HOTEL_NAME",
        display_name: "酒店名称",
        data_type: "varchar",
        length: 200,
        searchable: true,
        title_column: true,
      },
      {
        name: "CHECK_IN_TIME",
        display_name: "入住时间",
        data_type: "datetime",
        show_in_list: true,
      },
    ]),
  });
  ensure("privateTables", (item) => item.name === "CASE_EVENT", {
    name: "CASE_EVENT",
    display_name: "私有事件记录",
    category_id: eventCategory.id,
    source_table_id: metadataId("CASE_EVENT"),
    table_type: "business",
    is_internal: true,
    owner: "admin",
    row_count: 2,
    description: "私有数据表功能模拟",
  });

  const nameColumns = database.db
    .prepare(
      "SELECT id FROM meta_columns WHERE name IN ('NAME','CTFID','MOBILE') ORDER BY name",
    )
    .all()
    .map((item) => item.id);
  if (nameColumns.length)
    ensure("factors", (item) => item.name === "人员身份要素", {
      name: "人员身份要素",
      description: "姓名、证件号和手机字段集合",
      owner: "demo",
      field_ids_json: JSON.stringify(nameColumns),
    });

  for (const [table, rows] of [
    [
      person,
      [
        ["2026-08-27", 1, 2],
        ["2026-08-28", 1, 3],
      ],
    ],
    [
      hotel,
      [
        ["2026-08-27", 2, 2],
        ["2026-08-28", 1, 3],
      ],
    ],
  ])
    for (const [date, increase, total] of rows)
      ensure(
        "dailyCounts",
        (item) => item.table_name === table.name && item.stat_date === date,
        {
          table_id: table.id,
          table_name: table.name,
          stat_date: date,
          daily_increase: increase,
          total_count: total,
        },
      );

  ensure("cubes", (item) => item.name === "人员住宿分析", {
    name: "人员住宿分析",
    description: "人员与住宿记录的分析关系",
    definition_json: JSON.stringify({
      source: person.id,
      target: hotel.id,
      sourceColumn: "ID",
      targetColumn: "PERSON_ID",
    }),
  });
  for (const values of [
    { code: "TABLE_SCOPE", name: "数据表范围", type_group: "METADATA" },
    { code: "EVENT_TYPE", name: "事件类型", type_group: "BUSINESS" },
  ])
    ensure("systemTypes", (item) => item.code === values.code, values);

  console.log(
    JSON.stringify({
      databasePath,
      sourcePath,
      scannedTables: scan.tables,
      scannedColumns: scan.columns,
      managedTables: 3,
      dictionaries: 2,
      dailyCountRecords: 4,
    }),
  );
} finally {
  database.close();
}
