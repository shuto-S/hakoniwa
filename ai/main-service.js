// メインプロセス側の AI(Gemini)サービス。
// レンダラーからは IPC 経由でのみ呼ばれる(CSP のためレンダラーから外部 API は叩けない)。
// API キーは safeStorage で暗号化して userData に保存する。
// @google/genai は遅延 require し、読み込めない/失敗しても呼び出し側でフォールバックできるよう
// 例外にせず { ok:false, error } を返す。
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const KEY_FILE = () => path.join(app.getPath('userData'), 'ai-key.enc');

// (authMode + key)ごとにクライアントをキャッシュ(毎回作らない)
let cached = null; // { authMode, key, client }

function loadKey() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const enc = fs.readFileSync(KEY_FILE());
    const key = safeStorage.decryptString(enc);
    return key || null;
  } catch {
    return null;
  }
}

function storeKey(key) {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false;
    fs.mkdirSync(path.dirname(KEY_FILE()), { recursive: true });
    fs.writeFileSync(KEY_FILE(), safeStorage.encryptString(key));
    cached = null; // キーが変わったのでクライアントを作り直す
    return true;
  } catch {
    return false;
  }
}

function clearKey() {
  try {
    fs.rmSync(KEY_FILE(), { force: true });
  } catch {
    /* noop */
  }
  cached = null;
}

function hasKey() {
  return loadKey() !== null;
}

// authMode: 'developer'(AI Studio のキー)/ 'vertex-express'(Vertex Express のキー)
function getClient(authMode) {
  const key = loadKey();
  if (!key) return null;
  if (cached && cached.authMode === authMode && cached.key === key) return cached.client;

  let GoogleGenAI;
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
async function generate(opts) {
  const client = getClient(opts.authMode || 'developer');
  if (!client) return { ok: false, error: 'no-key-or-sdk' };

  const config = { maxOutputTokens: opts.maxOutputTokens || 256 };
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
    const res = await Promise.race([
      call,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ]);
    const text = typeof res.text === 'string' ? res.text : res.text?.();
    if (!text) return { ok: false, error: 'empty' };
    return { ok: true, text: text.trim() };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

// 接続テスト(ごく短い呼び出し)
async function testConnection(opts) {
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

module.exports = { storeKey, clearKey, hasKey, generate, testConnection };
