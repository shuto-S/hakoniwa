// フレーバー生成のオーケストレーション(プロンプト構築→生成→整形)。
// client は AiClient(または同じ形のモック): generate(req)->string|null, fill/take/size を持つ。
// すべて「生成できない/失敗時は null(名前は空)」を返すので、呼び出し側はフォールバックできる。
import {
  mutterRequest,
  poemRequest,
  taleRequest,
  chronicleRequest,
  namesRequest,
  cleanLine,
  parseNameList,
} from './flavor.js';

export async function generateMutter(client, ctx) {
  return cleanLine(await client.generate(mutterRequest(ctx)));
}

export async function generatePoem(client, kind, ctx) {
  return cleanLine(await client.generate(poemRequest(kind, ctx)), 40);
}

export async function generateTale(client, ctx) {
  return cleanLine(await client.generate(taleRequest(ctx)), 40);
}

export async function generateChronicle(client, events, ctx) {
  if (!events || events.length === 0) return null;
  return cleanLine(await client.generate(chronicleRequest(events, ctx)), 70);
}

// 名前プールを補充して、追加した名前の配列を返す(失敗時は空配列)
export async function refillNamePool(client, type, ctx) {
  const names = parseNameList(await client.generate(namesRequest(type, ctx)));
  client.fill(`name:${type}`, names);
  return names;
}
