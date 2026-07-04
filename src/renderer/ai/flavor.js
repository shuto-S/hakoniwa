// AI フレーバー生成のプロンプトを1か所にまとめる(純ロジック=テスト可能)。
// 生成そのものは AiClient(=メインプロセス)に委譲する。ここは「何を頼むか」だけ。

const LANG_NAME = { ja: 'Japanese', en: 'English' };

// 住民のひとりごと。ctx: { season, weather, timeOfDay, name, job, trait, lang }
export function mutterRequest(ctx) {
  const lang = LANG_NAME[ctx.lang] || 'Japanese';
  const system =
    `You write a single, very short line of dialogue (an idle mutter) for a villager ` +
    `in a cozy, wholesome hex-block garden game. ` +
    `Rules: reply in ${lang}; one line only, at most about 20 characters/6 words; ` +
    `in-character and gentle; no quotation marks, no emoji, no explanation. Output only the line.`;
  const parts = [
    `Season: ${ctx.season}`,
    `Weather: ${ctx.weather}`,
    `Time: ${ctx.timeOfDay}`,
    `Villager: ${ctx.name}`,
  ];
  if (ctx.job) parts.push(`Job: ${ctx.job}`);
  if (ctx.trait) parts.push(`Personality: ${ctx.trait}`);
  const prompt = `${parts.join(', ')}. What does this villager mutter to themselves right now?`;
  return { system, prompt, maxOutputTokens: 40 };
}

// 生成テキストを吹き出し用に整える(引用符除去・改行を潰す・長すぎたら切る)
export function cleanLine(text, maxLen = 28) {
  if (!text) return null;
  let s = String(text).trim().split('\n')[0].trim();
  s = s.replace(/^["'“”「」『』]+/, '').replace(/["'“”「」『』]+$/, '').trim();
  if (!s) return null;
  if (s.length > maxLen) s = s.slice(0, maxLen).trim() + '…';
  return s;
}
