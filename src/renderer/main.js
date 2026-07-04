import * as THREE from 'three';
import { DEFAULT_COLS, DEFAULT_MAX_HEIGHT, DEFAULT_SETTINGS } from './config.js';
import { World } from './world.js';
import { generateWorld } from './terrain.js';
import { SceneView } from './scene3d.js';
import { CharacterManager } from './characters.js';
import { Autopilot } from './autopilot.js';
import { WeatherSystem } from './weather.js';
import { DayNight } from './daynight.js';
import { WaterSim } from './water.js';
import { Aging } from './aging.js';
import { AmbientAudio } from './audio.js';
import { CritterSystem } from './critters.js';
import { SeasonalEvents } from './seasonal.js';
import { setupUI, showToast, setWeatherDisplay, setSeasonDisplay } from './ui.js';
import { t, setLanguage, getLanguage } from './i18n/index.js';
import { AiClient } from './ai/client.js';
import {
  generateMutter,
  generatePoem,
  generateTale,
  generateChronicle,
  generateWorldParams,
  refillNamePool,
} from './ai/generate.js';

async function loadSave() {
  try {
    const raw = await window.tsuminiwa.loadWorld();
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function spawnStarterCharacters(characters) {
  characters.spawn('villager');
  characters.spawn('villager');
  characters.spawn('sheep');
  characters.spawn('chicken');
}

async function main() {
  const state = {
    tool: 'grass',
    auto: false,
    gridSize: DEFAULT_COLS,
    maxHeight: DEFAULT_MAX_HEIGHT,
    settings: { ...DEFAULT_SETTINGS },
  };

  let world = null;
  let savedCharacters = null;

  const save = await loadSave();
  if (save && save.world) {
    try {
      world = World.deserialize(save.world);
      state.gridSize = world.cols;
      state.maxHeight = world.maxHeight;
      state.auto = Boolean(save.auto);
      Object.assign(state.settings, save.settings || {});
      savedCharacters = save.characters;
    } catch {
      world = null;
    }
  }
  if (!world) {
    world = generateWorld(state.gridSize, state.gridSize, state.maxHeight);
  }

  // 初回起動(セーブなし)は OS の言語で初期値を決める。以降は保存値に従う
  if (!save) {
    state.settings.language = navigator.language.startsWith('ja') ? 'ja' : 'en';
  }
  // 保存された言語を反映(以降の t() はこの言語で引かれる)
  setLanguage(state.settings.language);

  // AI クライアント(後続のフレーバー機能が使う。無効/失敗時は null を返す)。
  // 実生成はメインプロセス(window.tsuminiwa.ai)へ委譲する
  const ai = new AiClient(state.settings, window.tsuminiwa.ai);

  const viewport = document.getElementById('viewport');
  const view = new SceneView(viewport, world);
  const characters = new CharacterManager(view.scene, world, state.settings);
  const autopilot = new Autopilot(world, characters, state.settings);
  autopilot.enabled = state.auto;
  view.setShadows(state.settings.shadows);
  window.tsuminiwa.setPinned(state.settings.pinned);
  window.tsuminiwa.setAutoLaunch(state.settings.autoLaunch);

  let firstWeather = true;
  const weather = new WeatherSystem(view, world, state.settings, (kindKey, def) => {
    setWeatherDisplay(def.emoji, kindKey);
    if (!firstWeather) {
      showToast(t('event.weatherChanged', { emoji: def.emoji, label: t(`weather.${kindKey}`) }));
    }
    firstWeather = false;
  });
  const daynight = new DayNight(view, state.settings);
  if (save && typeof save.dayTime === 'number') daynight.t = save.dayTime;
  if (save && typeof save.day === 'number') daynight.day = save.day;
  const waterSim = new WaterSim(world);
  if (save) waterSim.load(save.waterDist);
  // 当日のできごとを貯めておく(朝のかわら版の材料)。通知は notify 経由に集約する
  const dayEvents = [];
  function notify(text) {
    if (dayEvents.length < 30) dayEvents.push(text);
    showToast(text);
  }
  const aging = new Aging(world, state.settings);
  aging.onEvent = notify;
  const critters = new CritterSystem(view.scene, world, weather, daynight, state.settings);
  const seasonal = new SeasonalEvents(view.scene, world, weather, daynight, state.settings);
  seasonal.onEvent = notify;
  const audio = new AmbientAudio(state.settings);
  weather.calendar = daynight;
  autopilot.weather = weather;
  autopilot.calendar = daynight;
  autopilot.onEvent = notify;
  characters.onEvent = notify;
  characters.calendar = daynight;

  // ---- レアなできごとに AI で一句/小話を添える(#4/#5)。無効・失敗時は何もしない ----
  let flavorBusy = false;
  async function onFlavor(kind) {
    if (flavorBusy || !ai.available()) return;
    // 旅人の小話は半分くらいの確率に絞る(毎回は出さない)
    if (kind === 'travelerleave' && Math.random() < 0.5) return;
    const ctx = { season: daynight.season.key, lang: getLanguage() };
    flavorBusy = true;
    try {
      const line =
        kind === 'travelerleave'
          ? await generateTale(ai, ctx)
          : await generatePoem(ai, kind, ctx);
      if (line) showToast(line);
    } finally {
      flavorBusy = false;
    }
  }
  critters.onFlavor = onFlavor;
  seasonal.onFlavor = onFlavor;
  characters.onFlavor = onFlavor;
  critters.onEvent = notify;

  // ---- AI命名(#6): 名前プールを背景で補充し、pickName が在庫を優先する ----
  // プールは AiClient(kind='name:<type>')。同期の spawn を壊さないための仕組み
  const AI_NAME_TYPES = ['villager', 'sheep', 'chicken'];
  characters.aiNamePool = { take: (type) => ai.take(`name:${type}`) };
  let nameRefilling = false;
  async function refillNamePools() {
    if (nameRefilling || !ai.available()) return;
    const low = AI_NAME_TYPES.find((tp) => ai.size(`name:${tp}`) < 2);
    if (!low) return;
    nameRefilling = true;
    try {
      await refillNamePool(ai, low, { season: daynight.season.key, lang: getLanguage() });
    } finally {
      nameRefilling = false;
    }
  }

  // 季節の変わり目: 葉と草の色、池の凍結、表示を更新する
  let lastSeasonIndex = -1;
  function applySeason(announce) {
    const season = daynight.season;
    view.seasonColors = { leaves: season.leaves, grass: season.grass };
    world.frozen = season.key === 'winter';
    world.version++; // 色と氷を描き直す
    characters.rescueStranded(); // 氷がとけて水上に取り残されたキャラを助ける
    setSeasonDisplay(season, daynight.day);
    if (announce) {
      showToast(t('event.seasonChanged', { emoji: season.emoji, name: t(`season.${season.key}`) }));
    }
  }
  let lastDay = daynight.day;
  applySeason(false);
  lastSeasonIndex = daynight.seasonIndex;

  // 住民のAIつぶやき: 有効時だけ、たまに手すきの村人が文脈に沿った一言を喋る。
  // 無効・キー無し・失敗・レート上限時は ai.generate が null を返し、何も出ない(従来どおり)
  let mutterTimer = 20 + Math.random() * 20;
  let muttering = false;
  async function updateMutters(dt) {
    if (muttering || !ai.available()) return;
    mutterTimer -= dt;
    if (mutterTimer > 0) return;
    mutterTimer = 25 + Math.random() * 35;
    const villager = characters.randomIdleVillager();
    if (!villager) return;
    muttering = true;
    try {
      const line = await generateMutter(ai, {
        season: daynight.season.key,
        weather: weather.state,
        timeOfDay: daynight.isNight ? 'night' : 'day',
        name: villager.name,
        job: villager.job || undefined,
        trait: villager.trait.key,
        lang: getLanguage(),
      });
      // まだその村人が手すきで存在していれば喋らせる
      if (line && characters.characters.includes(villager) && villager.state === 'idle') {
        characters.speak(villager, line);
      }
    } finally {
      muttering = false;
    }
  }

  // 朝のかわら版(#3): 日付が変わったら前日のできごとを短い日記にまとめて流す。
  // AI無効・できごと無し・失敗時は何も出ない(従来どおり)。dayEvents は必ずクリアする
  async function morningChronicle() {
    const events = dayEvents.splice(0, dayEvents.length); // 前日ぶんを取り出してクリア
    if (!ai.available() || events.length === 0) return;
    const line = await generateChronicle(ai, events, {
      day: daynight.day,
      season: daynight.season.key,
      lang: getLanguage(),
    });
    if (line) showToast(line);
  }

  let nameRefillTimer = 8; // 起動後まもなく一度、以降は定期的に名前プールを補充

  // ときどき訪問者がやってくる(たいてい旅人、たまにしか、まれにねこ)
  let visitorTimer = 90 + Math.random() * 150;
  function updateVisitors(dt) {
    visitorTimer -= dt;
    if (visitorTimer > 0) return;
    visitorTimer = 180 + Math.random() * 240;
    if (daynight.isNight) return;
    const roll = Math.random();
    const type = roll < 0.7 ? 'traveler' : roll < 0.87 ? 'deer' : 'cat';
    if (characters.spawnVisitor(type)) {
      notify(
        t(
          {
            traveler: 'event.visitorTraveler',
            deer: 'event.visitorDeer',
            cat: 'event.visitorCat',
          }[type]
        )
      );
    }
  }

  if (savedCharacters && savedCharacters.length > 0) {
    characters.deserialize(savedCharacters);
  } else {
    spawnStarterCharacters(characters);
  }

  // ---- 保存(変更から少し置いてまとめて書き込み) ----
  const snapshot = () =>
    JSON.stringify({
      world: world.serialize(),
      characters: characters.serialize(),
      auto: state.auto,
      settings: state.settings,
      dayTime: daynight.t,
      day: daynight.day,
      waterDist: waterSim.serialize(),
    });

  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => window.tsuminiwa.saveWorld(snapshot()), 1200);
  }

  // ---- UI ----
  setupUI(
    {
      rotate: (steps) => view.rotate(steps),
      quit: () => {
        clearTimeout(saveTimer);
        window.tsuminiwa.saveWorld(snapshot()).finally(() => window.tsuminiwa.quit());
      },
      autoChanged: (enabled) => {
        autopilot.enabled = enabled;
        scheduleSave();
      },
      spawn: (type) => {
        characters.spawn(type);
        scheduleSave();
      },
      getRoster: () => characters.roster(),
      capture: () => view.captureDataUrl(),
      saveShot: async (dataUrl) => {
        const file = await window.tsuminiwa.saveScreenshot(dataUrl);
        showToast(t(file ? 'shot.saved' : 'shot.saveFail'));
      },
      shareShot: async (dataUrl) => {
        const ok = await window.tsuminiwa.shareToX(dataUrl);
        showToast(t(ok ? 'shot.shared' : 'shot.shareFail'));
      },
      settingChanged: (key, value) => {
        state.settings[key] = value;
        if (key === 'language') {
          // 言語を変えたら、動的な表示(天気・季節)も引き直す
          setWeatherDisplay(weather.emoji, weather.state);
          setSeasonDisplay(daynight.season, daynight.day);
        }
        if (key === 'characterScale') characters.applyScale();
        if (key === 'shadows') view.setShadows(value);
        if (key === 'pinned') window.tsuminiwa.setPinned(value);
        if (key === 'autoLaunch') window.tsuminiwa.setAutoLaunch(value);
        scheduleSave();
      },
      regenerate: (size, maxHeight) => rebuildWorld(size, maxHeight),
      // ことばで世界をつくる(#3): AI無効/失敗時は何もしない(従来の世界は保たれる)
      worldgen: async (instruction) => {
        // キーが無いと「思い描いている…→失敗」が毎回チラつくので、先に確認する
        if (!ai.available() || !(await window.tsuminiwa.ai.hasKey())) return;
        showToast(t('ai.worldgenMaking'));
        const params = await generateWorldParams(ai, instruction, { lang: getLanguage() });
        if (params) {
          rebuildWorld(state.gridSize, state.maxHeight, params);
          showToast(t('ai.worldgenDone'));
        } else {
          showToast(t('ai.worldgenFail'));
        }
      },
    },
    state
  );

  // 世界を作り直す共通処理(手動リセット・ことばで世界生成の両方から)
  function rebuildWorld(size, maxHeight, params = null) {
    state.gridSize = size;
    state.maxHeight = maxHeight;
    world = generateWorld(size, size, maxHeight, params);
    view.setWorld(world);
    characters.setWorld(world);
    autopilot.setWorld(world);
    weather.setWorld(world);
    waterSim.setWorld(world);
    aging.setWorld(world);
    critters.setWorld(world);
    seasonal.setWorld(world);
    spawnStarterCharacters(characters);
    applySeason(false);
    renderedVersion = -1; // 新しい世界を必ず描き直す
    scheduleSave();
  }

  // ---- 入力 ----
  const canvas = view.renderer.domElement;
  let hovered = null;

  canvas.addEventListener('pointermove', (event) => {
    hovered = view.pick(event.clientX, event.clientY);
  });

  canvas.addEventListener('pointerleave', () => {
    hovered = null;
  });

  canvas.addEventListener('pointerdown', (event) => {
    const column = view.pick(event.clientX, event.clientY);
    if (!column) return;
    const remove = event.button === 2 || state.tool === 'erase';
    const changed = remove
      ? world.removeTop(column.col, column.row)
      : world.placeTop(column.col, column.row, state.tool);
    hovered = column;
    if (changed) {
      characters.rescueStranded(); // 足元を消されたキャラを近くの陸へ
      scheduleSave();
    }
  });

  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      view.addZoom(event.deltaY);
    },
    { passive: false }
  );

  window.addEventListener('resize', () => view.resize());

  // ---- メインループ ----
  const clock = new THREE.Clock();
  // 初回は必ず rebuild させる。SceneView の初期 rebuild は applySeason より前に
  // 走っているので、季節色や冬の氷が反映されていない(-1 で確実に描き直す)
  let renderedVersion = -1;

  // 省電力: フォーカスがないときは10fpsに落とす(ロジックはdtで進むので遅れない)
  let windowFocused = document.hasFocus();
  window.addEventListener('focus', () => (windowFocused = true));
  window.addEventListener('blur', () => (windowFocused = false));
  let lastFrameAt = 0;

  function frame(now) {
    if (state.settings.powerSave && !windowFocused && now - lastFrameAt < 95) {
      requestAnimationFrame(frame);
      return;
    }
    lastFrameAt = now;
    const dt = Math.min(0.1, clock.getDelta());
    const time = clock.elapsedTime;

    autopilot.update(dt);
    if (!world.frozen) waterSim.update(dt);
    aging.update(dt);
    weather.update(dt);
    daynight.update(dt, weather.current);

    // 季節と日付の変わり目
    if (daynight.seasonIndex !== lastSeasonIndex) {
      lastSeasonIndex = daynight.seasonIndex;
      applySeason(true);
    } else if (daynight.day !== lastDay) {
      setSeasonDisplay(daynight.season, daynight.day);
    }
    if (daynight.day !== lastDay) morningChronicle(); // 朝のかわら版(前日ぶん)
    lastDay = daynight.day;

    view.nightGlow = daynight.isNight ? 1 : 0;
    audio.update(dt, {
      weatherState: weather.state,
      daylight: daynight.daylight,
      isNight: daynight.isNight,
      season: daynight.season.key,
      campfires: view.campfires.length,
    });
    critters.update(dt);
    seasonal.update(dt);
    updateVisitors(dt);
    updateMutters(dt);
    nameRefillTimer -= dt;
    if (nameRefillTimer <= 0) {
      nameRefillTimer = 45;
      refillNamePools();
    }
    characters.update(dt, time, daynight.isNight);
    view.update(dt);

    if (world.version !== renderedVersion) {
      view.rebuild();
      renderedVersion = world.version;
      scheduleSave();
    }

    const mode = hovered ? (state.tool === 'erase' ? 'remove' : 'place') : null;
    view.setGhost(hovered, mode, state.tool === 'erase' ? 'grass' : state.tool);

    view.render();
    requestAnimationFrame(frame);
  }

  frame(performance.now());
}

main();
