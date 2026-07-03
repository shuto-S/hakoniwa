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
import { setupUI, showToast, setWeatherDisplay, setSeasonDisplay } from './ui.js';

async function loadSave() {
  try {
    const raw = await window.hakoniwa.loadWorld();
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

  const viewport = document.getElementById('viewport');
  const view = new SceneView(viewport, world);
  const characters = new CharacterManager(view.scene, world, state.settings);
  const autopilot = new Autopilot(world, characters, state.settings);
  autopilot.enabled = state.auto;
  view.setShadows(state.settings.shadows);
  window.hakoniwa.setPinned(state.settings.pinned);

  let firstWeather = true;
  const weather = new WeatherSystem(view, world, state.settings, (kind, def) => {
    setWeatherDisplay(def.emoji, def.label);
    if (!firstWeather) showToast(`${def.emoji} ${def.label}になった`);
    firstWeather = false;
  });
  const daynight = new DayNight(view, state.settings);
  if (save && typeof save.dayTime === 'number') daynight.t = save.dayTime;
  if (save && typeof save.day === 'number') daynight.day = save.day;
  const waterSim = new WaterSim(world);
  if (save) waterSim.load(save.waterDist);
  const aging = new Aging(world, state.settings);
  aging.onEvent = showToast;
  const critters = new CritterSystem(view.scene, world, weather, daynight, state.settings);
  const audio = new AmbientAudio(state.settings);
  weather.calendar = daynight;
  autopilot.weather = weather;
  autopilot.calendar = daynight;
  autopilot.onEvent = showToast;
  characters.onEvent = showToast;
  characters.calendar = daynight;
  critters.onEvent = showToast;

  // 季節の変わり目: 葉と草の色、池の凍結、表示を更新する
  let lastSeasonIndex = -1;
  function applySeason(announce) {
    const season = daynight.season;
    view.seasonColors = { leaves: season.leaves, grass: season.grass };
    world.frozen = season.key === 'winter';
    world.version++; // 色と氷を描き直す
    setSeasonDisplay(season, daynight.day);
    if (announce) showToast(`${season.emoji} ${season.name}になった`);
  }
  let lastDay = daynight.day;
  applySeason(false);
  lastSeasonIndex = daynight.seasonIndex;

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
      showToast(
        {
          traveler: '🚶 たびびとが やってきた',
          deer: '🦌 しかが あそびに きた',
          cat: '🐈 ねこが ふらりと あらわれた',
        }[type]
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
    saveTimer = setTimeout(() => window.hakoniwa.saveWorld(snapshot()), 1200);
  }

  // ---- UI ----
  setupUI(
    {
      rotate: (steps) => view.rotate(steps),
      quit: () => {
        clearTimeout(saveTimer);
        window.hakoniwa.saveWorld(snapshot()).finally(() => window.hakoniwa.quit());
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
      settingChanged: (key, value) => {
        state.settings[key] = value;
        if (key === 'characterScale') characters.applyScale();
        if (key === 'shadows') view.setShadows(value);
        if (key === 'pinned') window.hakoniwa.setPinned(value);
        scheduleSave();
      },
      regenerate: (size, maxHeight) => {
        state.gridSize = size;
        state.maxHeight = maxHeight;
        world = generateWorld(size, size, maxHeight);
        view.setWorld(world);
        characters.setWorld(world);
        autopilot.setWorld(world);
        weather.setWorld(world);
        waterSim.setWorld(world);
        aging.setWorld(world);
        critters.setWorld(world);
        spawnStarterCharacters(characters);
        applySeason(false);
        scheduleSave();
      },
    },
    state
  );

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
    if (remove) {
      world.removeTop(column.col, column.row);
    } else {
      world.placeTop(column.col, column.row, state.tool);
    }
    hovered = column;
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
  let renderedVersion = world.version;

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
    updateVisitors(dt);
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
