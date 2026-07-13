// preload ↔ main ↔ renderer をつなぐ IPC 境界の型。
// preload(実装)と renderer(window.tsuminiwa の利用側)の両方から参照して、
// メソッド名・引数・戻り値のズレを型で防ぐ。実行時コードは持たない(型のみ)。

export type AiAuthMode = 'developer' | 'vertex-express';

export interface AiGenerateOptions {
  authMode?: AiAuthMode;
  model?: string;
  system?: string;
  prompt?: string;
  schema?: unknown;
  maxOutputTokens?: number;
  tools?: unknown[];
  timeoutMs?: number;
}

export interface AiGenerateResult {
  ok: boolean;
  text?: string;
  error?: string;
}

export interface AiTestResult {
  ok: boolean;
  error?: string;
}

export interface AiBridge {
  setKey(key: string): Promise<boolean>;
  clearKey(): Promise<boolean>;
  hasKey(): Promise<boolean>;
  test(opts: { authMode: AiAuthMode; model: string }): Promise<AiTestResult>;
  generate(opts: AiGenerateOptions): Promise<AiGenerateResult>;
}

export interface SaveShotResult {
  ok?: boolean;
  canceled?: boolean;
  path?: string;
}

export interface WorldLoadResult {
  json: string | null;
  recovered: boolean;
  failed: boolean;
}

export interface TsuminiwaBridge {
  loadWorld(): Promise<WorldLoadResult>;
  saveWorld(json: string): Promise<boolean>;
  quit(): void;
  setPinned(pinned: boolean): void;
  saveScreenshot(dataUrl: string): Promise<SaveShotResult>;
  shareToX(dataUrl: string): Promise<boolean>;
  setAutoLaunch(enabled: boolean): void;
  ai: AiBridge;
}
