import { describe, expect, it } from 'vitest';
import { MetadataDatabase } from '../src/main/database.js';
import { MetadataManagementRepository } from '../src/main/management.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('MetadataManagementRepository', () => {
  it('initializes every management module and legacy weight defaults', () => {
    const database = new MetadataDatabase(':memory:');
    const repository = new MetadataManagementRepository(database.db);
    expect(repository.list('weights').map(item => [item.name, item.score])).toEqual([['Required', 80], ['Important', 50], ['Standard', 20]]);
    for (const module of ['dictionaries', 'dictionaryTree', 'factors', 'imports', 'tables', 'privateTables', 'dailyCounts', 'cubes', 'categories'] as const) {
      expect(repository.list(module)).toEqual([]);
    }
    database.close();
  });

  it('creates, updates and deletes records', () => {
    const database = new MetadataDatabase(':memory:');
    const repository = new MetadataManagementRepository(database.db);
    const created = repository.save('categories', { values: { name: 'Reference Data', display_order: 1 } });
    expect(repository.list('categories')).toHaveLength(1);
    repository.save('categories', { id: created.id, values: { name: 'Reference Data Category' } });
    expect(repository.list('categories')[0]?.name).toBe('Reference Data Category');
    repository.remove('categories', created.id);
    expect(repository.list('categories')).toEqual([]);
    database.close();
  });

  it('keeps private tables out of the public table filter', () => {
    const database = new MetadataDatabase(':memory:');
    const repository = new MetadataManagementRepository(database.db);
    repository.save('tables', { values: { name: 'PUBLIC_DATA', display_name: 'Public Data', is_public: 1 } });
    repository.save('privateTables', { values: { name: 'PRIVATE_DATA', display_name: 'Private Data', owner: 'admin' } });
    expect(repository.list('tables')).toHaveLength(2);
    expect(repository.list('privateTables').map(item => item.name)).toEqual(['PRIVATE_DATA']);
    database.close();
  });

  it('imports table metadata from a SQL file', () => {
    const database = new MetadataDatabase(':memory:');
    const repository = new MetadataManagementRepository(database.db);
    const file = path.join(os.tmpdir(), `datamaker-${Date.now()}.sql`);
    fs.writeFileSync(file, 'CREATE TABLE "DEMO" ("ID" INTEGER);\nCREATE TABLE app.USER_INFO (ID TEXT);', 'utf8');
    repository.save('imports', { values: { source_name: file, source_type: 'sql', target_name: '' } });
    expect(repository.list('imports')[0]?.status).toBe('completed');
    expect(repository.list('tables').map(item => item.name).sort()).toEqual(['DEMO', 'USER_INFO']);
    fs.unlinkSync(file);
    database.close();
  });
});
