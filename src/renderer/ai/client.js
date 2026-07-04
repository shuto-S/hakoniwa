// レンダラー側の AI クライアント。後続のフレーバー機能(#2/#3)はここだけを使う。
// - オプトイン判定(有効・キー・同意)をまとめる
// - コスト/レート上限ガード
// - プール(数回分をまとめて生成してキャッシュ)
// - 失敗・無効時は null を返す → 呼び出し側は必ず従来テキストにフォールバック
//
// 実際の生成はメインプロセス(window.tsuminiwa.ai)に委譲する。純ロジック(ガード・
// プール)はテストできるよう、外部依存(実際の生成関数・時刻)を注入できる形にする。

// 上限のデフォルト
export const AI_LIMITS = {
  maxPerDay: 200, // 1日あたりの生成回数
  minIntervalMs: 4000, // 連続生成の最小間隔
};

// レートとプールを管理する本体。backend/now を差し替えてテストする。
export class AiClient {
  // settings: 参照を渡す(aiEnabled/aiAuthMode/aiModel/aiConsent を見る)
  // backend: { generate(opts)->Promise<{ok,text}>, hasKey()->Promise<bool> }
  // now: () => ms
  constructor(settings, backend, { now = () => Date.now(), limits = AI_LIMITS } = {}) {
    this.settings = settings;
    this.backend = backend;
    this.now = now;
    this.limits = limits;
    this.lastCallAt = -Infinity;
    this.day = this.currentDay();
    this.countToday = 0;
    this.pools = new Map(); // kind -> string[]
  }

  currentDay() {
    return Math.floor(this.now() / 86400000);
  }

  // AI を使ってよいか(有効・同意・キー・レート上限)
  available() {
    const s = this.settings;
    return Boolean(s.aiEnabled && s.aiConsent);
  }

  underRate() {
    const d = this.currentDay();
    if (d !== this.day) {
      this.day = d;
      this.countToday = 0;
    }
    if (this.countToday >= this.limits.maxPerDay) return false;
    if (this.now() - this.lastCallAt < this.limits.minIntervalMs) return false;
    return true;
  }

  noteCall() {
    this.lastCallAt = this.now();
    this.countToday += 1;
  }

  // 1件だけ生成。使えない/失敗時は null(呼び出し側でフォールバック)
  async generate({ system, prompt, schema, maxOutputTokens } = {}) {
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
    return res && res.ok ? res.text : null;
  }

  // プールから1件取り出す。空なら null を返し、必要なら refill() で補充する運用。
  take(kind) {
    const pool = this.pools.get(kind);
    if (pool && pool.length > 0) return pool.shift();
    return null;
  }

  size(kind) {
    const pool = this.pools.get(kind);
    return pool ? pool.length : 0;
  }

  // まとめて生成した配列でプールを補充する(呼び出し側が JSON 配列を生成して渡す)
  fill(kind, items) {
    if (!Array.isArray(items) || items.length === 0) return;
    const pool = this.pools.get(kind) || [];
    pool.push(...items.filter((s) => typeof s === 'string' && s.trim()));
    this.pools.set(kind, pool);
  }
}
