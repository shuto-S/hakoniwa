// アプリ内の多言語対応。言語を増やすときは locales/ に辞書ファイルを足して
// LOCALES に登録するだけでよい(キーは ja を基準にする)。
import { ja } from './locales/ja.ts';
import { en } from './locales/en.ts';

// 訳文辞書。ほとんどのキーは文字列だが、names だけは種別→名前配列のオブジェクト。
interface LocaleDict {
  names: Record<string, string[]>;
  [key: string]: string | Record<string, string[]>;
}

// 表示順にならべる。ここに足せば設定の言語セレクタにも自動で出る
export const LOCALES = [
  { code: 'ja', label: '日本語', dict: ja },
  { code: 'en', label: 'English', dict: en },
];

const DICTS: Record<string, LocaleDict> = Object.fromEntries(
  LOCALES.map((l): [string, LocaleDict] => [l.code, l.dict]),
);
const FALLBACK = 'ja';

let current = FALLBACK;

export function setLanguage(code: string) {
  if (DICTS[code]) current = code;
}

export function getLanguage() {
  return current;
}

// キーから訳文を引く。{name} のようなプレースホルダを params で差し替える。
// 見つからなければ ja → キー文字列の順にフォールバックする
export function t(key: string, params?: Record<string, string | number>): string {
  const dict = DICTS[current] || DICTS[FALLBACK];
  let s = dict[key] as string | undefined;
  if (s === undefined) s = DICTS[FALLBACK][key] as string | undefined;
  if (s === undefined) return key;
  if (params) {
    for (const k of Object.keys(params)) s = s.split(`{${k}}`).join(params[k] as string);
  }
  return s;
}

// キャラクターの名前プール(言語ごとに用意。無ければ ja)
export function namesFor(type: string): string[] {
  const dict = DICTS[current] || DICTS[FALLBACK];
  return (dict.names && dict.names[type]) || DICTS[FALLBACK].names[type];
}

// data-i18n / data-i18n-title を持つ DOM に訳文を流し込む。
// data-i18n はテキスト、data-i18n-title はツールチップ(dataset.tip)に入れる
export function applyDomTranslations(root: ParentNode = document) {
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n as string);
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-title]')) {
    const label = t(el.dataset.i18nTitle as string);
    el.dataset.tip = label;
    el.setAttribute('aria-label', label);
  }
  for (const el of root.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]')) {
    el.placeholder = t(el.dataset.i18nPlaceholder as string);
  }
}
