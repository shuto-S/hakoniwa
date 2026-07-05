import { BLOCK_TYPES, AI_MODELS } from './config.ts';
import type { Settings } from './config.ts';
import { t, setLanguage, applyDomTranslations, LOCALES } from './i18n/index.ts';
import type { AiAuthMode } from '../shared/ipc.ts';

// window.tsuminiwa の型は global.d.ts で宣言済み。t() は i18n/index.ts で型付け済み。

interface Callbacks {
  rotate(dir: number): void;
  quit(): void;
  capture(): string;
  saveShot(shot: string | null): Promise<unknown> | void;
  shareShot(shot: string | null): Promise<unknown> | void;
  autoChanged(auto: boolean): void;
  spawn(type: string): void;
  regenerate(gridSize: number, maxHeight: number): void;
  settingChanged(key: string, value: unknown): void;
  worldgen?(instruction: string): void;
  getRoster?(): Iterable<string>;
}

interface State {
  tool: string;
  auto: boolean;
  gridSize: number;
  maxHeight: number;
  settings: Settings;
}

export function setupUI(callbacks: Callbacks, state: State) {
  // 静的な DOM(data-i18n / data-i18n-title)にまず訳文を流し込む
  applyDomTranslations();

  // ---- パレット ----
  const palette = document.getElementById('palette') as HTMLElement;
  const swatches = new Map<string, HTMLElement>();

  const select = (tool: string) => {
    state.tool = tool;
    for (const [key, el] of swatches) el.classList.toggle('selected', key === tool);
  };

  // パレットのツールチップは言語切替で引き直せるよう関数にまとめる
  const refreshPaletteTips = () => {
    for (const [key, el] of swatches) {
      el.dataset.tip =
        key === 'none'
          ? t('tip.none')
          : key === 'erase'
            ? t('tip.erase')
            : t('tip.place', { name: t(`block.${key}`) });
    }
  };

  // いちばん左は「なにもしない(見るだけ)」モード
  const none = document.createElement('div');
  none.className = 'swatch';
  none.style.background = 'rgba(255,255,255,0.15)';
  none.textContent = '🖐';
  none.addEventListener('click', () => select('none'));
  palette.appendChild(none);
  swatches.set('none', none);

  for (const [key, def] of Object.entries(BLOCK_TYPES)) {
    const el = document.createElement('div');
    el.className = 'swatch';
    el.style.background = `#${def.color.toString(16).padStart(6, '0')}`;
    el.addEventListener('click', () => select(key));
    palette.appendChild(el);
    swatches.set(key, el);
  }

  const eraser = document.createElement('div');
  eraser.className = 'swatch';
  eraser.style.background = 'rgba(255,255,255,0.15)';
  eraser.textContent = '⛏';
  eraser.addEventListener('click', () => select('erase'));
  palette.appendChild(eraser);
  swatches.set('erase', eraser);
  refreshPaletteTips();

  select(state.tool);

  // ---- トップバー ----
  document.getElementById('btn-rotate-left')!.addEventListener('click', () => callbacks.rotate(1));
  document
    .getElementById('btn-rotate-right')!
    .addEventListener('click', () => callbacks.rotate(-1));
  document.getElementById('btn-quit')!.addEventListener('click', () => callbacks.quit());
  // ---- スクショのプレビュー(撮る → 確認してから保存/シェア) ----
  const shotModal = document.getElementById('shot-modal') as HTMLElement;
  const shotPreview = document.getElementById('shot-preview') as HTMLImageElement;
  let currentShot: string | null = null;
  const closeShot = () => {
    shotModal.classList.add('hidden');
    shotPreview.src = '';
    currentShot = null;
  };
  document.getElementById('btn-shot')!.addEventListener('click', () => {
    currentShot = callbacks.capture();
    shotPreview.src = currentShot;
    shotModal.classList.remove('hidden');
  });
  // 閉じるのは「とじる」ボタンだけ。保存・シェアしてもプレビューは開いたまま
  document.getElementById('shot-close')!.addEventListener('click', closeShot);
  document.getElementById('shot-save')!.addEventListener('click', async () => {
    await callbacks.saveShot(currentShot);
  });
  document.getElementById('shot-share')!.addEventListener('click', async () => {
    await callbacks.shareShot(currentShot);
  });

  const autoButton = document.getElementById('btn-auto') as HTMLElement;
  const syncAutoButton = () => autoButton.classList.toggle('active', state.auto);
  autoButton.addEventListener('click', () => {
    state.auto = !state.auto;
    syncAutoButton();
    callbacks.autoChanged(state.auto);
  });
  syncAutoButton();

  // ---- 設定パネル ----
  const panel = document.getElementById('settings-panel') as HTMLElement;
  const renderRoster = () => {
    if (!callbacks.getRoster) return;
    const roster = document.getElementById('roster') as HTMLElement;
    roster.textContent = '';
    for (const line of callbacks.getRoster()) {
      const el = document.createElement('div');
      el.textContent = line;
      roster.appendChild(el);
    }
    if (roster.childElementCount === 0) roster.textContent = t('roster.empty');
  };
  // ---- タブ切り替え ----
  const tabs = [...panel.querySelectorAll<HTMLElement>('#settings-tabs .tab')];
  const panes = [...panel.querySelectorAll<HTMLElement>('.tab-pane')];
  const showTab = (name: string | undefined) => {
    for (const tab of tabs) tab.classList.toggle('active', tab.dataset.tab === name);
    for (const pane of panes) pane.classList.toggle('active', pane.dataset.pane === name);
    if (name === 'villagers') renderRoster(); // 「なかま」タブは開くたびに作り直す
  };
  for (const tab of tabs) tab.addEventListener('click', () => showTab(tab.dataset.tab));

  const closeSettings = () => panel.classList.add('hidden');
  document.getElementById('btn-settings')!.addEventListener('click', () => {
    const opening = panel.classList.contains('hidden');
    panel.classList.toggle('hidden');
    if (opening) showTab('villagers'); // 開いたら「なかま」を先頭に
  });
  document.getElementById('settings-close')!.addEventListener('click', closeSettings);
  panel.addEventListener('click', (event) => {
    if (event.target === panel) closeSettings(); // 背景クリックで閉じる
  });

  const gridSize = document.getElementById('grid-size') as HTMLInputElement;
  const gridSizeValue = document.getElementById('grid-size-value') as HTMLElement;
  const maxHeight = document.getElementById('max-height') as HTMLInputElement;
  const maxHeightValue = document.getElementById('max-height-value') as HTMLElement;

  gridSize.value = state.gridSize as unknown as string;
  maxHeight.value = state.maxHeight as unknown as string;
  gridSizeValue.textContent = t('unit.grid', { v: state.gridSize });
  maxHeightValue.textContent = state.maxHeight as unknown as string;

  gridSize.addEventListener('input', () => {
    gridSizeValue.textContent = t('unit.grid', { v: gridSize.value });
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
  const sliderRefreshers: (() => void)[] = []; // 言語切替で単位表示を引き直すため
  const bindSlider = (id: string, key: keyof Settings, format: (v: number) => string) => {
    const input = document.getElementById(id) as HTMLInputElement;
    const value = document.getElementById(`${id}-value`) as HTMLElement;
    input.value = state.settings[key] as string;
    const render = () => (value.textContent = format(Number(input.value)));
    render();
    sliderRefreshers.push(render);
    input.addEventListener('input', () => {
      render();
      callbacks.settingChanged(key, Number(input.value));
    });
  };
  const times = (v: number) =>
    t('unit.times', { v: v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '') });
  bindSlider('char-scale', 'characterScale', times);
  bindSlider('char-speed', 'characterSpeed', times);
  bindSlider('auto-speed', 'autoSpeed', times);
  bindSlider('day-length', 'dayLength', (v) => t('unit.minutes', { v: Math.round(v / 60) }));
  bindSlider('weather-interval', 'weatherInterval', (v) => t('unit.seconds', { v }));
  bindSlider('sound-volume', 'volume', (v) => t('unit.percent', { v: Math.round(v * 100) }));

  const bindCheckbox = (id: string, key: keyof Settings) => {
    const input = document.getElementById(id) as HTMLInputElement;
    input.checked = state.settings[key] as boolean;
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
  bindCheckbox('opt-autolaunch', 'autoLaunch');

  // ---- 言語セレクタ ----
  const langSelect = document.getElementById('opt-language') as HTMLSelectElement;
  for (const loc of LOCALES) {
    const opt = document.createElement('option');
    opt.value = loc.code;
    opt.textContent = loc.label;
    langSelect.appendChild(opt);
  }
  langSelect.value = state.settings.language;
  // 言語切替で引き直したい動的テキストの登録先(AI設定などが push する)
  const langRefreshers: (() => void)[] = [];
  langSelect.addEventListener('change', () => {
    setLanguage(langSelect.value);
    applyDomTranslations(); // 静的なテキスト・ツールチップ
    refreshPaletteTips();
    for (const r of sliderRefreshers) r();
    for (const r of langRefreshers) r();
    if (!panel.classList.contains('hidden')) renderRoster();
    callbacks.settingChanged('language', langSelect.value); // 天気・季節の引き直し+保存
  });

  document
    .getElementById('spawn-villager')!
    .addEventListener('click', () => callbacks.spawn('villager'));
  document.getElementById('spawn-sheep')!.addEventListener('click', () => callbacks.spawn('sheep'));
  document
    .getElementById('spawn-chicken')!
    .addEventListener('click', () => callbacks.spawn('chicken'));
  document.getElementById('btn-reset')!.addEventListener('click', () => {
    callbacks.regenerate(Number(gridSize.value), Number(maxHeight.value));
  });

  setupAiSettings(callbacks, state);
  setupTooltips();
  setupAutoHide();
}

// ---- AI(Gemini)設定の配線 ----
function setupAiSettings(callbacks: Callbacks, state: State) {
  const s = state.settings;
  const aiConfig = document.getElementById('ai-config') as HTMLElement;
  const enabled = document.getElementById('opt-ai-enabled') as HTMLInputElement;
  const authSel = document.getElementById('opt-ai-auth') as HTMLSelectElement;
  const modelSel = document.getElementById('opt-ai-model') as HTMLSelectElement;
  const keyInput = document.getElementById('ai-key-input') as HTMLInputElement;
  const keyStatus = document.getElementById('ai-key-status') as HTMLElement;
  const consent = document.getElementById('opt-ai-consent') as HTMLInputElement;

  // 認証方式・モデルの選択肢
  for (const [value, key] of [
    ['developer', 'settings.aiAuthDeveloper'],
    ['vertex-express', 'settings.aiAuthVertex'],
  ]) {
    const o = document.createElement('option');
    o.value = value;
    o.dataset.i18n = key; // 言語切替で applyDomTranslations が textContent を更新
    o.textContent = t(key);
    authSel.appendChild(o);
  }
  for (const m of AI_MODELS) {
    const o = document.createElement('option');
    o.value = o.textContent = m;
    modelSel.appendChild(o);
  }

  const keyInputLabel = keyInput.closest('label');
  const saveBtn = document.getElementById('ai-key-save') as HTMLElement;
  const clearBtn = document.getElementById('ai-key-clear') as HTMLElement;
  const testBtn = document.getElementById('ai-test') as HTMLElement;
  const refreshKeyStatus = async () => {
    const has = await window.tsuminiwa.ai.hasKey();
    keyStatus.textContent = t(has ? 'settings.aiKeySaved' : 'settings.aiKeyNone');
    // 保存済みなら入力欄と保存ボタンを隠し、消去・接続テストを出す。
    // 未保存なら入力欄と保存ボタンだけ出す(消去・接続テストは隠す)。
    if (keyInputLabel) keyInputLabel.classList.toggle('hidden', has);
    saveBtn.classList.toggle('hidden', has);
    clearBtn.classList.toggle('hidden', !has);
    testBtn.classList.toggle('hidden', !has);
  };

  const syncVisibility = () => aiConfig.classList.toggle('hidden', !enabled.checked);

  enabled.checked = s.aiEnabled;
  authSel.value = s.aiAuthMode;
  modelSel.value = s.aiModel;
  consent.checked = s.aiConsent;
  syncVisibility();
  refreshKeyStatus();

  enabled.addEventListener('change', () => {
    syncVisibility();
    callbacks.settingChanged('aiEnabled', enabled.checked);
  });
  authSel.addEventListener('change', () => callbacks.settingChanged('aiAuthMode', authSel.value));
  modelSel.addEventListener('change', () => callbacks.settingChanged('aiModel', modelSel.value));
  consent.addEventListener('change', () => callbacks.settingChanged('aiConsent', consent.checked));

  document.getElementById('ai-key-save')!.addEventListener('click', async () => {
    const key = keyInput.value.trim();
    if (!key) return;
    const ok = await window.tsuminiwa.ai.setKey(key);
    keyInput.value = '';
    showToast(t(ok ? 'ai.keySaved' : 'ai.keySaveFail'));
    refreshKeyStatus();
  });
  document.getElementById('ai-key-clear')!.addEventListener('click', async () => {
    await window.tsuminiwa.ai.clearKey();
    showToast(t('ai.keyCleared'));
    refreshKeyStatus();
  });
  document.getElementById('ai-test')!.addEventListener('click', async () => {
    if (!(await window.tsuminiwa.ai.hasKey())) return showToast(t('ai.needKey'));
    const r = await window.tsuminiwa.ai.test({
      authMode: authSel.value as AiAuthMode,
      model: modelSel.value,
    });
    showToast(r.ok ? t('ai.testOk') : t('ai.testFail', { error: r.error || '' }));
  });

  // ことばで世界をつくる(#3)
  const wgInput = document.getElementById('ai-worldgen-input') as HTMLInputElement;
  const runWorldgen = () => {
    const instruction = wgInput.value.trim();
    if (!instruction || !callbacks.worldgen) return;
    wgInput.value = '';
    callbacks.worldgen(instruction);
  };
  document.getElementById('ai-worldgen-go')!.addEventListener('click', runWorldgen);
  wgInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runWorldgen();
  });
}

// フォーカスが外れてしばらくしたらUIをフェードアウトする(箱庭だけ残る)
const CHROME_HIDE_DELAY = 3000;

function setupAutoHide() {
  let timer: ReturnType<typeof setTimeout> | null = null;
  window.addEventListener('blur', () => {
    clearTimeout(timer!);
    timer = setTimeout(() => document.body.classList.add('chrome-hidden'), CHROME_HIDE_DELAY);
  });
  window.addEventListener('focus', () => {
    clearTimeout(timer!);
    document.body.classList.remove('chrome-hidden');
  });
}

// できごとを画面のすみにふわっと出す
export function showToast(text: string) {
  let container = document.getElementById('toasts');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toasts';
    document.getElementById('app')!.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = text;
  container.appendChild(toast);
  while (container.children.length > 3) container.firstChild!.remove();
  setTimeout(() => toast.classList.add('fade'), 3200);
  setTimeout(() => toast.remove(), 4000);
}

// トップバーの天気表示を更新(state は 'sunny' などのキー)
export function setWeatherDisplay(emoji: string, state: string) {
  const el = document.getElementById('weather') as HTMLElement;
  el.textContent = emoji;
  el.dataset.tip = t('tip.weather', { label: t(`weather.${state}`) });
}

// トップバーの季節・日数表示を更新
export function setSeasonDisplay(season: { key: string; emoji: string }, day: number) {
  const el = document.getElementById('season') as HTMLElement;
  const name = t(`season.${season.key}`);
  el.textContent = `${season.emoji}${t('unit.day', { v: day + 1 })}`;
  el.dataset.tip = t('tip.season', { name, day: day + 1 });
}

// data-i18n-title / 動的な dataset.tip をマウスオーバーで出すツールチップにする
function setupTooltips() {
  const tip = document.createElement('div');
  tip.id = 'tooltip';
  document.body.appendChild(tip);

  const show = (el: HTMLElement) => {
    tip.textContent = el.dataset.tip as string;
    tip.classList.add('visible');
    const rect = el.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    // 画面の下半分なら上に、上半分なら下に出す
    const above = rect.top > window.innerHeight / 2;
    const x = Math.max(
      4,
      Math.min(
        window.innerWidth - tipRect.width - 4,
        rect.left + rect.width / 2 - tipRect.width / 2,
      ),
    );
    const y = above ? rect.top - tipRect.height - 6 : rect.bottom + 6;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  };

  const hide = () => tip.classList.remove('visible');

  // dataset.tip を持つ(あるいは動的に入る)要素にホバー表示をつける。
  // 訳文は applyDomTranslations / refreshPaletteTips / 各 setter が dataset.tip に入れる
  for (const el of document.querySelectorAll<HTMLElement>(
    '[data-i18n-title], .swatch, #weather, #season',
  )) {
    el.addEventListener('mouseenter', () => show(el));
    el.addEventListener('mouseleave', hide);
    el.addEventListener('click', hide);
  }
}
