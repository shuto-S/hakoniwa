// メインプロセス側の AI(Gemini)サービス。
// レンダラーからは IPC 経由でのみ呼ばれる(CSP のためレンダラーから外部 API は叩けない)。
// API キーは safeStorage で暗号化して userData に保存する。
// @google/genai は遅延 require し、読み込めない/失敗しても呼び出し側でフォールバックできるよう
// 例外にせず { ok:false, error } を返す。
import fs from 'node:fs';
import path from 'node:path';
import { app, safeStorage } from 'electron';
import type {
  AiAuthMode,
  AiGenerateOptions,
  AiGenerateResult,
  AiTestResult,
} from '../shared/ipc.ts';

const KEY_FILE = (): string => path.join(app.getPath('userData'), 'ai-key.enc');

// safeStorage(Keychain 等)が使えない環境向けの保険。署名なしの dev 起動や
// キーチェーンにアクセスできない端末では isEncryptionAvailable() が false になり、
// 暗号化保存ができない。そのときは本人しか読めない権限(0600)で平文保存する。
// この目印で始まるファイルは平文とみなす。
const PLAIN_PREFIX = Buffer.from('tsuminiwa-plain:v1\n');

// @google/genai の型には依存しない(未インストールでも動く設計のため any で扱う)
type GenAiClient = any;
interface ClientCache {
  authMode: AiAuthMode;
  key: string;
  client: GenAiClient;
}

// (authMode + key)ごとにクライアントをキャッシュ(毎回作らない)
let cached: ClientCache | null = null;

function loadKey(): string | null {
  try {
    const buf = fs.readFileSync(KEY_FILE());
    // 平文フォールバックで保存されたもの
    if (
      buf.length >= PLAIN_PREFIX.length &&
      buf.subarray(0, PLAIN_PREFIX.length).equals(PLAIN_PREFIX)
    ) {
      return buf.subarray(PLAIN_PREFIX.length).toString('utf8') || null;
    }
    if (!safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(buf) || null;
  } catch {
    return null;
  }
}

export function storeKey(key: string): boolean {
  try {
    fs.mkdirSync(path.dirname(KEY_FILE()), { recursive: true });
    const data = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(key)
      : Buffer.concat([PLAIN_PREFIX, Buffer.from(key, 'utf8')]); // 端末が暗号化を使えないとき
    fs.writeFileSync(KEY_FILE(), data, { mode: 0o600 });
    cached = null; // キーが変わったのでクライアントを作り直す
    return true;
  } catch {
    return false;
  }
}

export function clearKey(): void {
  try {
    fs.rmSync(KEY_FILE(), { force: true });
  } catch {
    /* noop */
  }
  cached = null;
}

export function hasKey(): boolean {
  return loadKey() !== null;
}

// authMode: 'developer'(AI Studio のキー)/ 'vertex-express'(Vertex Express のキー)
function getClient(authMode: AiAuthMode): GenAiClient | null {
  const key = loadKey();
  if (!key) return null;
  if (cached && cached.authMode === authMode && cached.key === key) return cached.client;

  let GoogleGenAI: any;
  try {
    ({ GoogleGenAI } = require('@google/genai'));
  } catch {
    return null; // SDK が無ければ AI は使えない → 呼び出し側でフォールバック
  }
  const client =
    authMode === 'vertex-express'
      ? new GoogleGenAI({ vertexai: true, apiKey: key })
      : new GoogleGenAI({ apiKey: key });
  cached = { authMode, key, client };
  return client;
}

// 1回の生成。opts: { authMode, model, system, prompt, schema, maxOutputTokens, timeoutMs }
export async function generate(opts: AiGenerateOptions): Promise<AiGenerateResult> {
  const client = getClient(opts.authMode || 'developer');
  if (!client) return { ok: false, error: 'no-key-or-sdk' };

  const config: Record<string, unknown> = { maxOutputTokens: opts.maxOutputTokens || 256 };
  if (opts.system) config.systemInstruction = opts.system;
  if (opts.schema) {
    config.responseMimeType = 'application/json';
    config.responseSchema = opts.schema;
  }
  // function calling(#4 用): アクションレジストリから作ったツール宣言を渡せる
  if (opts.tools && opts.tools.length) {
    config.tools = [{ functionDeclarations: opts.tools }];
  }

  const call = client.models.generateContent({
    model: opts.model || 'gemini-2.5-flash',
    contents: opts.prompt || '',
    config,
  });

  // タイムアウト付きで待つ(遅い時はフォールバックに落とす)
  const timeoutMs = opts.timeoutMs || 12000;
  try {
    const res: any = await Promise.race([
      call,
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ]);
    const text = typeof res.text === 'string' ? res.text : res.text?.();
    if (!text) return { ok: false, error: 'empty' };
    return { ok: true, text: text.trim() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// 接続テスト(ごく短い呼び出し)
export async function testConnection(opts: {
  authMode?: AiAuthMode;
  model?: string;
}): Promise<AiTestResult> {
  if (!hasKey()) return { ok: false, error: 'no-key' };
  const r = await generate({
    authMode: opts.authMode,
    model: opts.model,
    prompt: 'Reply with the single word: ok',
    maxOutputTokens: 8,
    timeoutMs: 12000,
  });
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}
