// 自己記述する世界モデル(#5)。ゲームロジックが使うのと同じ source から、
// AI 向けの機械可読な記述(ブロック/イベント/アクション)を生成する。
// 新要素は「説明を1行足す or 登録するだけ」で AI 側が自動対応できる。
import { BLOCK_TYPES } from '../config.js';
import { t } from '../i18n/index.js';

// ブロックの AI 向け説明(英語1行。表示名は i18n の block.<key> から引く)。
// 新ブロックを足したらここに1行足すだけでフレーバー/世界生成が扱える。
const BLOCK_DESC = {
  grass: 'grassy ground where plants and flowers grow',
  dirt: 'bare earth',
  stone: 'hard rock, for mountains and walls',
  sand: 'sandy ground near water',
  wood: 'tree trunk / timber',
  leaves: 'tree foliage',
  brick: 'building material for houses',
  snow: 'snow that piles up in winter',
  water: 'water; flows downhill, freezes in winter',
  campfire: 'a campfire with flame and smoke',
  ash: 'ashes left after a campfire burns out',
  farm: 'a tilled field where crops grow',
};

// 現在の言語での名前 + 英語説明の一覧
export function describeBlocks() {
  return Object.keys(BLOCK_TYPES).map((key) => ({
    key,
    name: t(`block.${key}`),
    desc: BLOCK_DESC[key] || '',
  }));
}

// ---- イベント descriptor レジストリ ----
const events = new Map();
export function registerEvent(kind, def) {
  events.set(kind, def);
}
export function describeEvent(kind) {
  return events.get(kind) || null;
}
export function listEvents() {
  return [...events.entries()].map(([kind, def]) => ({ kind, ...def }));
}

// 既定のレア/できごと(英語 subject。フレーバーの一句がこれを引く)
registerEvent('whale', { subject: 'a giant whale drifting slowly across the sky' });
registerEvent('meteor', { subject: 'a meteor shower streaking across the night' });
registerEvent('goldfish', { subject: 'a golden fish leaping from the pond' });
registerEvent('aurora', { subject: 'the aurora shimmering over the winter night' });
registerEvent('blacklamb', { subject: 'a rare black lamb born in the village' });

// ---- アクションレジストリ(#4 が使う器) ----
// def: { key, description, params(JSON schema), execute(character, params, world) }
const actions = new Map();
export function registerAction(def) {
  actions.set(def.key, def);
}
export function getAction(key) {
  return actions.get(key) || null;
}
export function listActions() {
  return [...actions.values()];
}
// Gemini function calling 用のツール宣言に変換
export function actionFunctionDeclarations() {
  return listActions().map((a) => ({
    name: a.key,
    description: a.description,
    parameters: a.params || { type: 'object', properties: {} },
  }));
}

// テスト用にレジストリを空にする(既定イベントは消える)
export function _resetRegistries() {
  events.clear();
  actions.clear();
}

// 静的なケイパビリティ表(変化が少ないのでキャッシュ可能)
export function worldManifest() {
  return {
    blocks: describeBlocks(),
    events: listEvents(),
    actions: listActions().map((a) => ({ key: a.key, description: a.description })),
  };
}
