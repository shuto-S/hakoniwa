// 六角柱の寸法(外接円半径と1段の高さ)
export const HEX_RADIUS = 0.5;
export const HEX_WIDTH = Math.sqrt(3) * HEX_RADIUS; // 平坦な辺どうしの距離
export const BLOCK_HEIGHT = 0.5;

export const DEFAULT_COLS = 15;
export const DEFAULT_ROWS = 15;
export const DEFAULT_MAX_HEIGHT = 8;
export const MAX_CHARACTERS = 12;

export const BLOCK_TYPES = {
  grass: { name: 'くさ', color: 0x6cc75a },
  dirt: { name: 'つち', color: 0x9a6a44 },
  stone: { name: 'いし', color: 0xa9a9b0 },
  sand: { name: 'すな', color: 0xe8d79a },
  wood: { name: 'き', color: 0x7d5638 },
  leaves: { name: 'はっぱ', color: 0x3f9c46 },
  brick: { name: 'レンガ', color: 0xc06045 },
  snow: { name: 'ゆき', color: 0xf1f5f8 },
  water: { name: 'みず', color: 0x4aa8e8, water: true },
  campfire: { name: 'たきび', color: 0x6b4a2f, fire: true },
  ash: { name: 'はい', color: 0x6e6a66 },
  farm: { name: 'はたけ', color: 0x7a5a38 },
};

export const FLOWER_COLORS = [0xf27ea9, 0xf2d54e, 0xffffff, 0xb98aef];

// 季節。weights は天気の出やすさ、leaves/grass は葉と草の色
export const DAYS_PER_SEASON = 3;
export const SEASONS = [
  {
    key: 'spring', name: 'はる', emoji: '🌸',
    leaves: 0x5fbf63, grass: 0x6cc75a,
    weights: { sunny: 0.42, cloudy: 0.28, rain: 0.26, snow: 0.04 },
  },
  {
    key: 'summer', name: 'なつ', emoji: '🌻',
    leaves: 0x2f8f3c, grass: 0x58bb4a,
    weights: { sunny: 0.55, cloudy: 0.23, rain: 0.2, snow: 0.02 },
  },
  {
    key: 'autumn', name: 'あき', emoji: '🍁',
    leaves: 0xd07a2e, grass: 0x9db04e,
    weights: { sunny: 0.4, cloudy: 0.3, rain: 0.22, snow: 0.08 },
  },
  {
    key: 'winter', name: 'ふゆ', emoji: '⛄',
    leaves: 0x8a7a52, grass: 0xb9c4b4,
    weights: { sunny: 0.3, cloudy: 0.3, rain: 0.06, snow: 0.34 },
  },
];

export const CHARACTER_TYPES = ['villager', 'sheep', 'chicken'];

// 設定パネルからユーザーが変えられる値
export const DEFAULT_SETTINGS = {
  characterScale: 1.45, // キャラクターの見た目の大きさ
  characterSpeed: 1, // キャラクターの歩く・動き出すはやさ(倍率)
  autoSpeed: 1, // 自動発展のはやさ(倍率)
  shadows: true, // デスクトップに影を落とす
  pinned: true, // 常に最前面に表示
  powerSave: true, // 非アクティブ時はフレームレートを落とす
  sound: true, // 環境音
  volume: 0.5, // 音量(0〜1)
  skyShows: true, // 空の演出(虹・ながれぼし)
  decay: true, // 時のうつろい(燃え尽き・枯れ・崩れ)
  weather: true, // 天気がうつりかわる
  weatherInterval: 60, // 天気が変わる間隔(秒)
  dayNight: true, // 昼夜サイクル
  dayLength: 360, // 1日の長さ(秒)
};
