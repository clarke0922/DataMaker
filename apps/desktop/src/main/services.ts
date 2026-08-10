import { randomUUID } from 'node:crypto';
import type { ApiResult, ManagementModule, ManagementRecordDto, MetadataStatsDto, SaveManagementRecordInput, SearchHitDto, SystemInfoDto } from '@datamaker/contracts';
import type { MetadataDatabase } from './database.js';
import type { MetadataManagementRepository } from './management.js';

const ok = <T>(data: T): ApiResult<T> => ({ ok: true, data, requestId: randomUUID() });
const fail = (message: string): ApiResult<never> => ({ ok: false, requestId: randomUUID(), error: { code: 'INVALID_INPUT', category: 'VALIDATION', message, retryable: false } });
const attempt = <T>(operation: () => T): ApiResult<T> => {
  try { return ok(operation()); }
  catch (error) { return fail(error instanceof Error ? error.message : 'Operation failed'); }
};

export class ApplicationServices {
  constructor(private readonly database: MetadataDatabase, private readonly management: MetadataManagementRepository, private readonly infoFactory: () => SystemInfoDto) {}
  systemInfo(): ApiResult<SystemInfoDto> { return ok(this.infoFactory()); }
  metadataStats(): ApiResult<MetadataStatsDto> { return ok(this.database.stats()); }
  metadataSearch(query: string): ApiResult<SearchHitDto[]> {
    if (query.length > 100) return fail('Search queries cannot exceed 100 characters');
    return ok(this.database.search(query));
  }
  managementList(module: ManagementModule): ApiResult<ManagementRecordDto[]> { return attempt(() => this.management.list(module)); }
  managementSave(module: ManagementModule, input: SaveManagementRecordInput): ApiResult<ManagementRecordDto> { return attempt(() => this.management.save(module, input)); }
  managementRemove(module: ManagementModule, id: string): ApiResult<void> { return attempt(() => this.management.remove(module, id)); }
}
