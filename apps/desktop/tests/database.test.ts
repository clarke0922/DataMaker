import { describe, expect, it } from 'vitest';
import { MetadataDatabase } from '../src/main/database.js';

describe('MetadataDatabase', () => {
  it('creates the initial schema and seeds quality rules', () => {
    const database = new MetadataDatabase(':memory:');
    expect(database.stats()).toEqual({ sources: 0, tables: 0, columns: 0, relations: 0, qualityIssues: 0 });
    expect(database.initialized()).toBe(false);
    const rules = (database.db.prepare('SELECT count(*) AS count FROM quality_rules').get() as { count: number }).count;
    expect(rules).toBe(6);
    database.close();
  });

  it('enforces foreign keys', () => {
    const database = new MetadataDatabase(':memory:');
    expect(() => database.db.prepare("INSERT INTO user_roles(user_id, role_id) VALUES('missing-user','missing-role')").run()).toThrow();
    database.close();
  });
});
