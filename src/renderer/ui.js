import { BLOCK_TYPES } from './config.js';

export function setupUI(callbacks, state) {
  // ---- パレット ----
  const palette = document.getElementById('palette');
  const swatches = new Map();

  const select = (tool) => {
    state.tool = tool;
    for (const [key, el] of swatches) el.classList.toggle('selected', key === tool);
  };

  for (const [key, def] of Object.entries(BLOCK_TYPES)) {
    const el = document.createElement('div');
    el.className = 'swatch';
    el.title = `${def.name}を置く`;
    el.style.background = `#${def.color.toString(16).padStart(6, '0')}`;
    el.addEventListener('click', () => select(key));
    palette.appendChild(el);
    swatches.set(key, el);
  }

  const eraser = document.createElement('div');
  eraser.className = 'swatch';
  eraser.title = 'ブロックをこわす(右クリックでも可)';
  eraser.style.background = 'rgba(255,255,255,0.15)';
  eraser.textContent = '⛏';
  eraser.addEventListener('click', () => select('erase'));
  palette.appendChild(eraser);
  swatches.set('erase', eraser);

  select(state.tool);

  // ---- トップバー ----
  document.getElementById('btn-rotate-left').addEventListener('click', () => callbacks.rotate(1));
  document.getElementById('btn-rotate-right').addEventListener('click', () => callbacks.rotate(-1));
  document.getElementById('btn-quit').addEventListener('click', () => callbacks.quit());

  const autoButton = document.getElementById('btn-auto');
  const syncAutoButton = () => autoButton.classList.toggle('active', state.auto);
  autoButton.addEventListener('click', () => {
    state.auto = !state.auto;
    syncAutoButton();
    callbacks.autoChanged(state.auto);
  });
  syncAutoButton();

  // ---- 設定パネル ----
  const panel = document.getElementById('settings-panel');
  document.getElementById('btn-settings').addEventListener('click', () => {
    panel.classList.toggle('hidden');
    // 開くたびに「なかま」一覧を作り直す
    if (!panel.classList.contains('hidden') && callbacks.getRoster) {
      const roster = document.getElementById('roster');
      roster.textContent = '';
      for (const line of callbacks.getRoster()) {
        const el = document.createElement('div');
        el.textContent = line;
        roster.appendChild(el);
      }
      if (roster.childElementCount === 0) roster.textContent = 'まだ だれもいない';
    }
  });

  const gridSize = document.getElementById('grid-size');
  const gridSizeValue = document.getElementById('grid-size-value');
  const maxHeight = document.getElementById('max-height');
  const maxHeightValue = document.getElementById('max-height-value');

  gridSize.value = state.gridSize;
  maxHeight.value = state.maxHeight;
  gridSizeValue.textContent = `${state.gridSize}×${state.gridSize}`;
  maxHeightValue.textContent = state.maxHeight;

  gridSize.addEventListener('input', () => {
    gridSizeValue.textContent = `${gridSize.value}×${gridSize.value}`;
  });
  maxHeight.addEventListener('input', () => {
    maxHeightValue.textContent = maxHeight.value;
  });
  gridSize.addEventListener('change', () => {
    callbacks.regenerate(Number(gridSize.value), Number(maxHeight.value));
  });
  maxHeight.addEventListener('change', () => {
    callbacks.regenerate(Number(gridSize.value), Number(maxHeight.value));
  });

  // ---- ゲーム設定(その場で反映) ----
  const bindSlider = (id, key, format) => {
    const input = document.getElementById(id);
    const value = document.getElementById(`${id}-value`);
    input.value = state.settings[key];
    value.textContent = format(state.settings[key]);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      value.textContent = format(v);
      callbacks.settingChanged(key, v);
    });
  };
  const times = (v) => `×${v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}`;
  bindSlider('char-scale', 'characterScale', times);
  bindSlider('char-speed', 'characterSpeed', times);
  bindSlider('auto-speed', 'autoSpeed', times);
  bindSlider('day-length', 'dayLength', (v) => `${Math.round(v / 60)}分`);
  bindSlider('weather-interval', 'weatherInterval', (v) => `${v}秒`);
  bindSlider('sound-volume', 'volume', (v) => `${Math.round(v * 100)}%`);

  const bindCheckbox = (id, key) => {
    const input = document.getElementById(id);
    input.checked = state.settings[key];
    input.addEventListener('change', () => callbacks.settingChanged(key, input.checked));
  };
  bindCheckbox('opt-weather', 'weather');
  bindCheckbox('opt-daynight', 'dayNight');
  bindCheckbox('opt-decay', 'decay');
  bindCheckbox('opt-sound', 'sound');
  bindCheckbox('opt-sky', 'skyShows');
  bindCheckbox('opt-shadows', 'shadows');
  bindCheckbox('opt-pinned', 'pinned');
  bindCheckbox('opt-powersave', 'powerSave');

  document.getElementById('spawn-villager').addEventListener('click', () => callbacks.spawn('villager'));
  document.getElementById('spawn-sheep').addEventListener('click', () => callbacks.spawn('sheep'));
  document.getElementById('spawn-chicken').addEventListener('click', () => callbacks.spawn('chicken'));
  document.getElementById('btn-reset').addEventListener('click', () => {
    callbacks.regenerate(Number(gridSize.value), Number(maxHeight.value));
  });

  setupTooltips();
  setupAutoHide();
}

// フォーカスが外れてしばらくしたらUIをフェードアウトする(箱庭だけ残る)
const CHROME_HIDE_DELAY = 3000;

function setupAutoHide() {
  let timer = null;
  window.addEventListener('blur', () => {
    clearTimeout(timer);
    timer = setTimeout(() => document.body.classList.add('chrome-hidden'), CHROME_HIDE_DELAY);
  });
  window.addEventListener('focus', () => {
    clearTimeout(timer);
    document.body.classList.remove('chrome-hidden');
  });
}

// できごとを画面のすみにふわっと出す
export function showToast(text) {
  let container = document.getElementById('toasts');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toasts';
    document.getElementById('app').appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = text;
  container.appendChild(toast);
  while (container.children.length > 3) container.firstChild.remove();
  setTimeout(() => toast.classList.add('fade'), 3200);
  setTimeout(() => toast.remove(), 4000);
}

// トップバーの天気表示を更新
export function setWeatherDisplay(emoji, label) {
  const el = document.getElementById('weather');
  el.textContent = emoji;
  el.dataset.tip = `いまの天気: ${label}`;
}

// トップバーの季節・日数表示を更新
export function setSeasonDisplay(season, day) {
  const el = document.getElementById('season');
  el.textContent = `${season.emoji}${day + 1}日`;
  el.dataset.tip = `${season.name}・${day + 1}日め`;
}

// title 属性をマウスオーバーで即座に出るツールチップに変換する
function setupTooltips() {
  const tip = document.createElement('div');
  tip.id = 'tooltip';
  document.body.appendChild(tip);

  const show = (el) => {
    tip.textContent = el.dataset.tip;
    tip.classList.add('visible');
    const rect = el.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    // 画面の下半分なら上に、上半分なら下に出す
    const above = rect.top > window.innerHeight / 2;
    const x = Math.max(
      4,
      Math.min(window.innerWidth - tipRect.width - 4, rect.left + rect.width / 2 - tipRect.width / 2)
    );
    const y = above ? rect.top - tipRect.height - 6 : rect.bottom + 6;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  };

  const hide = () => tip.classList.remove('visible');

  for (const el of document.querySelectorAll('[title]')) {
    el.dataset.tip = el.getAttribute('title');
    el.removeAttribute('title');
    el.addEventListener('mouseenter', () => show(el));
    el.addEventListener('mouseleave', hide);
    el.addEventListener('click', hide);
  }
}
