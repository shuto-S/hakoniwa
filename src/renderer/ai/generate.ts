// フレーバー生成のオーケストレーション(プロンプト構築→生成→整形)。
// client は AiClient(または同じ形のモック): generate(req)->string|null, fill/take/size を持つ。
// すべて「生成できない/失敗時は null(名前は空)」を返すので、呼び出し側はフォールバックできる。
import {
  mutterRequest,
  poemRequest,
  taleRequest,
  chronicleRequest,
  namesRequest,
  worldgenRequest,
  cleanLine,
  parseNameList,
  parseParams,
} from './flavor.ts';
import type { MutterCtx, PoemCtx, TaleCtx, ChronicleCtx, NamesCtx } from './flavor.ts';
import { describeEvent, describeBlocks } from './registry.ts';
import { WORLDGEN_PARAMS, worldgenSchema, clampParams } from '../worldgen-schema.ts';
import type { AiClient } from './client.ts';

export async function generateMutter(client: AiClient, ctx: MutterCtx) {
  return cleanLine(await client.generate(mutterRequest(ctx)));
}

export async function generatePoem(client: AiClient, kind: string, ctx: PoemCtx) {
  // 一句の題材は #5 のイベント descriptor から引く(直書きしない)
  const desc = describeEvent(kind);
  return cleanLine(
    await client.generate(poemRequest({ ...ctx, subject: desc ? desc.subject : undefined })),
    40,
  );
}

export async function generateTale(client: AiClient, ctx: TaleCtx) {
  return cleanLine(await client.generate(taleRequest(ctx)), 40);
}

export async function generateChronicle(client: AiClient, events: string[], ctx: ChronicleCtx) {
  if (!events || events.length === 0) return null;
  return cleanLine(await client.generate(chronicleRequest(events, ctx)), 70);
}

// ことばで世界生成: 指示から地形パラメータを作り、クランプして返す(失敗時は null)
export async function generateWorldParams(
  client: AiClient,
  instruction: string,
  ctx: { lang: string },
) {
  const paramDocs = Object.entries(WORLDGEN_PARAMS).map(([key, d]) => ({ key, ...d }));
  const text = await client.generate(
    worldgenRequest(instruction, {
      lang: ctx.lang,
      blocks: describeBlocks(),
      paramDocs,
      schema: worldgenSchema(),
    }),
  );
  const raw = parseParams(text);
  return raw ? clampParams(raw) : null;
}

// 名前プールを補充して、追加した名前の配列を返す(失敗時は空配列)
export async function refillNamePool(client: AiClient, type: string, ctx: NamesCtx) {
  const names = parseNameList(await client.generate(namesRequest(type, ctx)));
  client.fill(`name:${type}`, names);
  return names;
}
