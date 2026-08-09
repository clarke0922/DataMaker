export type ErrorCategory =
  | 'VALIDATION' | 'AUTHENTICATION' | 'AUTHORIZATION' | 'NOT_FOUND'
  | 'CONFLICT' | 'SOURCE' | 'PARSER' | 'DATABASE' | 'INTERNAL';

export interface AppErrorDto {
  code: string;
  category: ErrorCategory;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export type ApiResult<T> =
  | { ok: true; data: T; requestId: string }
  | { ok: false; error: AppErrorDto; requestId: string };

export interface SystemInfoDto {
  version: string;
  platform: string;
  databasePath: string;
  apiPort: number | null;
  initialized: boolean;
}

export interface MetadataStatsDto {
  sources: number;
  tables: number;
  columns: number;
  relations: number;
  qualityIssues: number;
}

export interface SearchHitDto {
  id: string;
  objectType: 'table' | 'column';
  name: string;
  path: string;
  comment: string | null;
}

export interface DesktopApi {
  system: {
    info(): Promise<ApiResult<SystemInfoDto>>;
  };
  metadata: {
    stats(): Promise<ApiResult<MetadataStatsDto>>;
    search(query: string): Promise<ApiResult<SearchHitDto[]>>;
  };
}

export const IPC_CHANNELS = {
  systemInfo: 'system:info',
  metadataStats: 'metadata:stats',
  metadataSearch: 'metadata:search'
} as const;
