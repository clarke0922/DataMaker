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

export type ManagementModule =
  | 'weights' | 'dictionaries' | 'dictionaryTree' | 'factors'
  | 'imports' | 'tables' | 'privateTables' | 'dailyCounts'
  | 'cubes' | 'categories';

export interface ManagementRecordDto {
  id: string;
  [key: string]: string | number | boolean | null;
}

export interface SaveManagementRecordInput {
  id?: string;
  values: Record<string, string | number | boolean | null>;
}

export interface DesktopApi {
  system: {
    info(): Promise<ApiResult<SystemInfoDto>>;
    chooseImportFile(): Promise<ApiResult<string | null>>;
  };
  metadata: {
    stats(): Promise<ApiResult<MetadataStatsDto>>;
    search(query: string): Promise<ApiResult<SearchHitDto[]>>;
  };
  management: {
    list(module: ManagementModule): Promise<ApiResult<ManagementRecordDto[]>>;
    save(module: ManagementModule, input: SaveManagementRecordInput): Promise<ApiResult<ManagementRecordDto>>;
    remove(module: ManagementModule, id: string): Promise<ApiResult<void>>;
  };
}

export const IPC_CHANNELS = {
  systemInfo: 'system:info',
  systemChooseImportFile: 'system:choose-import-file',
  metadataStats: 'metadata:stats',
  metadataSearch: 'metadata:search',
  managementList: 'management:list',
  managementSave: 'management:save',
  managementRemove: 'management:remove'
} as const;
