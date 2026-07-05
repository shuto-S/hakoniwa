// ことばで世界生成(#3)のパラメータ定義。ゲーム側のクランプ範囲と、
// AI に渡す structured output のスキーマを 1 か所で共有する。
// 値はすべて 0..1(比率)や倍率。範囲外は clampParams でクランプされる。

interface WorldgenParam {
  min: number;
  max: number;
  default: number;
  desc: string;
}

export const WORLDGEN_PARAMS: Record<string, WorldgenParam> = {
  waterLevel: { min: 0, max: 0.6, default: 0.22, desc: '0=no water, higher=more ponds/sea' },
  hilliness: { min: 0.3, max: 2, default: 1, desc: 'terrain height variation multiplier' },
  treeDensity: { min: 0, max: 3, default: 1, desc: 'how many trees (1=normal)' },
  flowerDensity: { min: 0, max: 4, default: 1, desc: 'how many flowers (1=normal)' },
  snow: { min: 0, max: 1, default: 0, desc: 'fraction of tops turned to snow' },
  sandiness: { min: 0, max: 1, default: 0.08, desc: 'width of sandy shores' },
};

// AI 向け structured output スキーマ(数値だけ。範囲は clamp 側で担保)
export function worldgenSchema() {
  const properties: Record<string, { type: string }> = {};
  for (const key of Object.keys(WORLDGEN_PARAMS)) {
    properties[key] = { type: 'number' };
  }
  return { type: 'object', properties };
}

// 受け取った params を既定で埋め、範囲にクランプする(不正値は無視して既定へ)
export function clampParams(
  params: Record<string, number> | null | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, def] of Object.entries(WORLDGEN_PARAMS)) {
    const v =
      params && typeof params[key] === 'number' && Number.isFinite(params[key])
        ? params[key]
        : def.default;
    out[key] = Math.max(def.min, Math.min(def.max, v));
  }
  return out;
}
