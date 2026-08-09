import type { DesktopApi } from '@datamaker/contracts';

declare global {
  interface Window { datamaker: DesktopApi }
}

export {};
