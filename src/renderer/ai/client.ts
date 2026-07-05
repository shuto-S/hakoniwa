// レンダラー側の AI クライアント。後続のフレーバー機能(#2/#3)はここだけを使う。
// - オプトイン判定(有効・キー・同意)をまとめる
// - コスト/レート上限ガード
// - プール(数回分をまとめて生成してキャッシュ)
// - 失敗・無効時は null を返す → 呼び出し側は必ず従来テキストにフォールバック
//
// 実際の生成はメインプロセス(window.tsuminiwa.ai)に委譲する。純ロジック(ガード・
// プール)はテストできるよう、外部依存(実際の生成関数・時刻)を注入できる形にする。

import type { AiAuthMode, AiGenerateOptions, AiGenerateResult } from '../../shared/ipc.ts';

// 上限のデフォルト
export const AI_LIMITS = {
  maxPerDay: 200, // 1日あたりの生成回数
  minIntervalMs: 4000, // 連続生成の最小間隔
  cooldownMs: 30 * 60 * 1000, // ハードエラー(クォータ枯渇・認証不正)後、AI をしばらく止める
};

// onNotice に渡すハードエラーの種類
export type AiFailureKind = 'quota' | 'auth';

interface AiBackend {
  hasKey(): Promise<boolean>;
  generate(opts: AiGenerateOptions): Promise<AiGenerateResult>;
}

interface AiClientSettings {
  aiEnabled: boolean;
  aiConsent: boolean;
  aiAuthMode: AiAuthMode;
  aiModel: string;
}

interface AiClientOptions {
  now?: () => number;
  limits?: Partial<typeof AI_LIMITS>;
}

// レートとプールを管理する本体。backend/now を差し替えてテストする。
export class AiClient {
  settings: AiClientSettings;
  backend: AiBackend;
  now: () => number;
  limits: typeof AI_LIMITS;
  lastCallAt: number;
  day: number;
  countToday: number;
  pools: Map<string, string[]>;
  cooldownUntil: number; // ハードエラー後、この時刻まで AI を止める
  onNotice: ((kind: AiFailureKind) => void) | null; // ハードエラーを一度だけ知らせるフック

  // settings: 参照を渡す(aiEnabled/aiAuthMode/aiModel/aiConsent を見る)
  // backend: { generate(opts)->Promise<{ok,text}>, hasKey()->Promise<bool> }
  // now: () => ms
  constructor(
    settings: AiClientSettings,
    backend: AiBackend,
    { now = () => Date.now(), limits }: AiClientOptions = {},
  ) {
    this.settings = settings;
    this.backend = backend;
    this.now = now;
    this.limits = { ...AI_LIMITS, ...limits };
    this.lastCallAt = -Infinity;
    this.day = this.currentDay();
    this.countToday = 0;
    this.pools = new Map(); // kind -> string[]
    this.cooldownUntil = 0;
    this.onNotice = null;
  }

  currentDay(): number {
    return Math.floor(this.now() / 86400000);
  }

  // AI を使ってよいか(有効・同意・クールダウン中でない)
  available(): boolean {
    const s = this.settings;
    if (!(s.aiEnabled && s.aiConsent)) return false;
    if (this.now() < this.cooldownUntil) return false; // ハードエラー後のクールダウン中
    return true;
  }

  // 失敗の種類を見て、クォータ枯渇・認証不正などのハードエラーなら AI をしばらく止めて
  // 一度だけ通知する。タイムアウト・空応答などの一時的失敗は静かにフォールバックする。
  noteFailure(error: string): void {
    const e = String(error).toLowerCase();
    let kind: AiFailureKind | null = null;
    if (/resource_exhausted|quota|credit|billing|rate.?limit|\b429\b/.test(e)) kind = 'quota';
    else if (/unauthenticated|permission_denied|api.?key|invalid.*key|\b401\b|\b403\b/.test(e))
      kind = 'auth';
    if (!kind) return;
    this.cooldownUntil = this.now() + this.limits.cooldownMs;
    if (this.onNotice) this.onNotice(kind);
  }

  underRate(): boolean {
    const d = this.currentDay();
    if (d !== this.day) {
      this.day = d;
      this.countToday = 0;
    }
    if (this.countToday >= this.limits.maxPerDay) return false;
    if (this.now() - this.lastCallAt < this.limits.minIntervalMs) return false;
    return true;
  }

  noteCall(): void {
    this.lastCallAt = this.now();
    this.countToday += 1;
  }

  // 1件だけ生成。使えない/失敗時は null(呼び出し側でフォールバック)
  async generate({ system, prompt, schema, maxOutputTokens }: AiGenerateOptions = {}): Promise<
    string | null | undefined
  > {
    if (!this.available() || !this.underRate()) return null;
    // レート枠は await の前に同期で確保する。そうしないと、同じフレームで並行して
    // 走る別種の生成(つぶやき/かわら版/命名補充)が古い lastCallAt を見て、
    // 最小間隔・日次上限をすり抜けてしまう(TOCTOU)
    this.noteCall();
    if (!(await this.backend.hasKey())) return null;
    const res = await this.backend.generate({
      authMode: this.settings.aiAuthMode,
      model: this.settings.aiModel,
      system,
      prompt,
      schema,
      maxOutputTokens,
    });
    if (res && res.ok) return res.text;
    if (res && res.error) this.noteFailure(res.error); // ハードエラーならクールダウン+通知
    return null;
  }

  // プールから1件取り出す。空なら null を返し、必要なら refill() で補充する運用。
  take(kind: string): string | null | undefined {
    const pool = this.pools.get(kind);
    if (pool && pool.length > 0) return pool.shift();
    return null;
  }

  size(kind: string): number {
    const pool = this.pools.get(kind);
    return pool ? pool.length : 0;
  }

  // まとめて生成した配列でプールを補充する(呼び出し側が JSON 配列を生成して渡す)
  fill(kind: string, items: string[]): void {
    if (!Array.isArray(items) || items.length === 0) return;
    const pool = this.pools.get(kind) || [];
    pool.push(...items.filter((s) => typeof s === 'string' && s.trim()));
    this.pools.set(kind, pool);
  }
}
