import { randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import { MetadataDatabase } from "../dist/main/database.js";
import { AccessRepository } from "../dist/main/access.js";

const username = process.argv[2] ?? "admin";
const databasePath =
  process.env.DATAMAKER_DB_PATH ??
  join(process.env.APPDATA ?? "", "DataMaker", "datamaker.db");
const password = `Dm!9${randomBytes(12).toString("base64url")}`;
const database = new MetadataDatabase(databasePath);

try {
  const access = new AccessRepository(database.db);
  const user = access
    .listUsers()
    .find((item) => item.username.toLowerCase() === username.toLowerCase());
  if (!user) throw new Error(`User not found: ${username}`);
  access.saveUser({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    status: "active",
    password,
    roleIds: user.roleIds,
  });
  database.db
    .prepare(
      "INSERT INTO audit_logs(id,actor_user_id,action,object_type,object_id,result,context_json,occurred_at) VALUES(?,NULL,'auth.password.reset','user',?,'success',?,?)",
    )
    .run(
      randomUUID(),
      user.id,
      JSON.stringify({ method: "local-recovery" }),
      new Date().toISOString(),
    );
  console.log(JSON.stringify({ username: user.username, password }));
} finally {
  database.close();
}
