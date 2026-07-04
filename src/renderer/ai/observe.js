// 観測シリアライザ(#5)。世界をデータモデルから汎用に走査して、AI に渡す
// コンパクトな記述にする。手組みオブジェクトをやめるので、新しいブロック/状態は
// 追加コードなしで観測に乗る。

// character の周囲を観測する。ctx: { weather, season, timeOfDay, recentEvents }
export function observeWorld(world, character, ctx = {}) {
  const self = {
    name: character.name,
    type: character.type,
    job: character.job || null,
    trait: character.trait ? character.trait.key : null,
    col: character.col,
    row: character.row,
  };

  // 近傍のマス(隣接)を、一番上のブロック種で汎用に列挙。
  // 新ブロックを足しても topType が返すので自動で乗る。
  const nearby = [];
  for (const [nc, nr] of world.neighbors(character.col, character.row)) {
    nearby.push({
      col: nc,
      row: nr,
      dCol: nc - character.col,
      dRow: nr - character.row,
      block: world.topType(nc, nr), // null=空
      height: world.heightAt(nc, nr),
      walkable: world.isWalkable(nc, nr),
    });
  }

  // 近くの他のキャラ(あれば)。managerが渡す all から距離で絞る
  const others = [];
  if (Array.isArray(ctx.characters)) {
    for (const c of ctx.characters) {
      if (c === character) continue;
      const d = world.distance(character.col, character.row, c.col, c.row);
      if (d <= 3) others.push({ name: c.name, type: c.type, distance: d });
    }
    others.sort((a, b) => a.distance - b.distance);
  }

  return {
    self,
    weather: ctx.weather || null,
    season: ctx.season || null,
    timeOfDay: ctx.timeOfDay || null,
    nearby,
    others: others.slice(0, 5),
    recentEvents: (ctx.recentEvents || []).slice(-6),
  };
}
