import { randomUUID } from 'node:crypto';
import type { ApiResult, MetadataStatsDto, SearchHitDto, SystemInfoDto } from '@datamaker/contracts';
import type { MetadataDatabase } from './database.js';

const ok = <T>(data: T): ApiResult<T> => ({ ok: true, data, requestId: randomUUID() });
const fail = (message: string): ApiResult<never> => ({ ok: false, requestId: randomUUID(), error: { code: 'INVALID_INPUT', category: 'VALIDATION', message, retryable: false } });

export class ApplicationServices {
  constructor(private readonly database: MetadataDatabase, private readonly infoFactory: () => SystemInfoDto) {}
  systemInfo(): ApiResult<SystemInfoDto> { return ok(this.infoFactory()); }
  metadataStats(): ApiResult<MetadataStatsDto> { return ok(this.database.stats()); }
  metadataSearch(query: string): ApiResult<SearchHitDto[]> {
    if (query.length > 100) return fail('搜索词不能超过 100 个字符');
    return ok(this.database.search(query));
  }
}
