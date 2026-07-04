# AGENTS.md — 開発エージェント向けガイド

デスクトップの端に常時最前面で浮かぶ、六角ブロックの箱庭ゲーム(Electron + Three.js)。
ユーザーはブロックを積んで世界を作り、キャラクターが自律的に歩き回り、
自動発展モード(autopilot)で世界がひとりでに育つ。季節・昼夜・天気がめぐり、
環境音が鳴る「眺める系」。UI は日本語(ひらがな中心)。

セットアップ・リリース・トラブルシューティングの手順は [DEVELOPMENT.md](DEVELOPMENT.md) を参照。
ここにはコードの構造と設計判断をまとめる。

## コマンド

```sh
npm install        # 依存インストール(allow-scripts に注意 → DEVELOPMENT.md)
npm run build      # esbuild で renderer をバンドル(dist/renderer.js)
npm run watch      # バンドルの watch モード
npm start          # build + electron 起動
npm test           # node:test によるユニットテスト(test/*.test.mjs)
npm run package    # macOS アプリ化(release/はこにわ-darwin-arm64/はこにわ.app)
```

テストは純ロジック(world / terrain / water)を対象にしている。
`src/renderer/package.json` の `{"type":"module"}` により Node が renderer の
ESM をそのまま import できる(three に依存しないモジュールだけテスト可能)。
**world.js や terrain.js のロジックを変えたら `npm test`、描画や振る舞いを変えたら
実際に起動して確認する**(`ELECTRON_ENABLE_LOGGING=1 npx electron .` で
レンダラーのコンソールも標準出力に出る)。
時間系の機能は設定の「1日の長さ」「天気の変わる間隔」を最短にすると早く確認できる。

## アーキテクチャ

```
main.js                    Electron メイン。透明・フレームレス・常時最前面ウィンドウ、
                           world.json の読み書き IPC(保存先: app.getPath('userData'))
preload.js                 contextBridge で window.hakoniwa を公開(loadWorld/saveWorld/quit/setPinned)
index.html / style.css     UI の DOM。トップバー(-webkit-app-region: drag)、パレット、設定パネル
src/renderer/
  main.js                  エントリポイント。セーブ読込→各モジュール初期化→入力→rAF ループ
  config.js                寸法定数・BLOCK_TYPES(ブロック定義)・キャラ種別
  world.js                 World クラス。六角グリッドのデータモデル(描画と完全分離)。
                           マス走査は columnsWhere(fn) / topsOfType(type) を使う(手書きループ禁止)
  terrain.js               初期地形生成(バリューノイズ)、木のプラン
                           (treePlan / treeRemovalPlan / isTreeColumn — 枯れと伐採で共用)
  characterMeshes.js       キャラの見た目(MAKERS)。job/variant で衣装・持ち物が変わる
  scene3d.js               SceneView クラス。Three.js の描画すべて(カメラ・ライト・InstancedMesh・ピッキング)
  characters.js            Character / CharacterManager。自律移動するキャラ(villager/sheep/chicken)
  autopilot.js             自動発展ルール(草の伝播・花・木・雪・小屋の建設キュー、天気・季節連動)
  weather.js               天気システム(はれ/くもり/あめ/ゆき)。雲・雨・雪のパーティクル、
                           雨の水たまり、雨あがりの虹。明るさは current に持つだけ(下記)
  daynight.js              昼夜サイクル。weather.current と掛け合わせてライトに適用する唯一の場所
  water.js                 水の伝播シミュレーション(低い方へ流れ、平地は MAX_SPREAD マスまで)
  aging.js                 時のうつろい。たきび燃え尽き→灰→消滅、花の寿命、木の立ち枯れ、家の崩落。
                           年齢は保存されない(再起動でリセット)。分解は queue で1ブロックずつ
  critters.js              観賞用の生き物・空(鳥の群れ・蝶・魚・ほたる・落ち葉・水鳥・ながれぼし)。
                           世界に影響しない
  audio.js                 環境音。音声ファイルなし、すべて Web Audio でプロシージャル生成
                           (雨・風ノイズ、鳥チャープ、虫パルス、たきびクラックル)。
                           settings.sound オフで AudioContext を suspend
  ui.js                    DOM イベントの配線 + トースト通知(showToast)・天気表示・ツールチップ
```

このほかリポジトリ直下に `build/`(アプリアイコンの元絵と icns)、
`release/`(パッケージ出力、git 管理外)がある。

レンダラーは esbuild で `dist/renderer.js`(IIFE)にバンドルされる。
**トップレベル await は使えない**(async main() で包む)。nodeIntegration は無効、
メインプロセスへのアクセスは `window.hakoniwa` 経由のみ。

各システムは main.js の rAF ループから毎フレーム update(dt) される独立クラスで、
相互参照は main.js が注入する(autopilot.weather、weather.calendar など)。
グリッドサイズ変更時は全システムの setWorld(world) が呼ばれる —
**新システムを足すときは regenerate コールバックへの setWorld 追加を忘れない**。

## 重要な設計ポイント

### 六角グリッド(world.js)
- **odd-r オフセット座標**(尖った頂点が上下の pointy-top、奇数行が右に半マスずれる)。
  隣接マスのオフセットは行の偶奇で異なる(`NEIGHBORS_EVEN` / `NEIGHBORS_ODD`)。
- 各マスは `stacks[row * cols + col]` のブロック種配列。**null は空中**を表し、
  木の葉のような浮遊ブロックを表現する(`setBlock` が null 埋めする)。
- `world.version` が変更カウンタ。renderer のループが version の変化を見て
  `view.rebuild()`(全 InstancedMesh 再構築)と自動保存を走らせる。
  **World を変更するメソッドは必ず version++ すること。**
- 花(flowers)はブロックではなく `Set<"col,row">` の飾りレイヤー。ブロックを置くと消える。

### 描画(scene3d.js)
- ブロックは 2 つの InstancedMesh(不透明・水)。毎回全再構築で十分速い(15×15×8 ≦ 1800個)。
- 花とたきびは数が少ないので通常メッシュの詳細モデル(makeFlower / makeCampfire)。
  共有ジオメトリ・マテリアルは buildDecorAssets() に集約(setWorld をまたいで使い回す)。
  たきびは炎2層+煙3玉+石+薪で、詳細モデルは24個・PointLight は3個まで。
- `solidInfo` / `waterInfo` が instanceId → マス の対応表。ピッキングはこれを引く。
- 六角柱は `CylinderGeometry(r, r, h, 6)`。デフォルトの向きが pointy-top レイアウトと一致している。
- カメラは OrthographicCamera、仰角38度固定、60度単位で回転(azimuthTarget へイージング)。
- ウィンドウは透明。地面には ShadowMaterial の板があり、デスクトップに影だけ落ちる。
- 葉と草の色は `view.seasonColors`、水面の凍結見た目は `world.frozen` を rebuild が参照。
  家のあかりは `view.nightGlow`(main が毎フレーム 0/1 を設定)で点灯する。
- rebuild の最後で InstancedMesh の `boundingSphere = null` にしている。
  **これを消すと、高く積んだブロックがレイキャストに当たらなくなる**(境界球が古いままのため)。
- キャラのメッシュはパーツごとに固有ジオメトリ/マテリアルを持つので、シーンから
  外すとき必ず characters.js の disposeMesh() を通す(常駐アプリのGPUリーク防止)。
  卵・花・たきび・作物は共有アセットなので破棄しない。

### ライティングの流れ
- weather.js はライトを直接触らず `weather.current`(天気ぶんの明るさ)を持つだけ。
  毎フレーム daynight.js が `weather.current × 昼夜係数` を計算して view.sun / view.ambient に
  適用する。**ライトへの書き込みは daynight.update に集約すること**(取り合いになるため)。
  例外: たきびの PointLight(scene3d)と家のあかり(view.nightGlow 経由)。

### 季節(カレンダー)
- daynight.js が day(経過日数)を持ち、DAYS_PER_SEASON 日ごとに SEASONS(config.js)がめぐる。
- 季節の適用は main.js の applySeason() に集約: 葉と草の色(view.seasonColors)、
  池の凍結(world.frozen)、表示、トースト。weather.calendar / autopilot.calendar にも
  daynight を注入して、天気の重みや植生の挙動を季節で変えている。
- world.frozen 中は WaterSim を止める(main 側で gate)。isWalkable は凍結水面を歩行可にする。

### キャラクター
- 状態は idle / walking / eating / sleeping / working / fishing / dancing。
- **個性**: 全キャラが name(NAMES から重複回避で命名)・trait(TRAITS: 速度と行動間隔の倍率)・
  jitter(体格)を持つ。villager はさらに job(きこり/のうふ/つりびと/むらびと、
  最少人数の職に就く)。しごとで見た目(斧・麦わら帽子・釣り竿)が変わる。
  一覧は manager.roster() → 設定パネルの「むらの なかまたち」。
- **しごと**: manager.updateJobs() が昼にタスクを割り当て(assignTask)、キャラが現場へ歩いて
  working/fishing 状態で作業 → taskDone を manager が回収して効果を適用(applyTaskEffect)。
  きこりの伐採・植樹は manager.jobQueue で1ブロックずつ反映。のうふは world.crops
  (はたけの上の作物、stage 0..2、季節倍率で成長・冬は停止)を植えて収穫する。
- 夜(daynight.isNight): ひとは manager.setNight() で家・たきびに割り当てられて歩いて向かい、
  着くと sleeping。動物はその場で眠る。朝に起きる。
  **3日にいちど(day % 3 === 2)、たきびがあればおまつり**: 全員が火を囲んで dancing。
- 世代: にわとりの卵(manager.eggs、保存されない)→ ひよこ、こひつじ誕生、baby は
  BABY_SCALE で小さく GROW_TIME で成長。
- **訪問者**(VISITOR_TYPES)は歩数制で去る。main の updateVisitors が種類を抽選する。
  旅人だけ、家に空きがあれば villager として移住。**serialize には含めない**。

### レアイベント(ネタバレ注意)
- 低確率・超低確率の訪問者やできごとが存在するが、**プレイヤーの楽しみを守るため
  種類・確率はドキュメントに書かない**(README でも「ひみつ」とだけ匂わせている)。
  実装は critters.js と characters.js の低確率ロール+トースト通知のパターンを参照。
  新しいレアを足すときも同じパターンに倣い、ドキュメントには具体を書かないこと。

### 設定の追加手順
新しい設定(DEFAULT_SETTINGS のキー)を足すときは4か所:
1. `config.js` の DEFAULT_SETTINGS にデフォルト値
2. `index.html` の設定パネルにスライダー or チェックボックス
3. `ui.js` で bindSlider / bindCheckbox
4. 即時反映が必要なら `main.js` の settingChanged に分岐
(各システムが settings オブジェクトへの参照を持っているので、値の読み取りだけなら 4 は不要)

### セーブ
- world + characters + auto フラグ + settings + dayTime + day + waterDist を JSON で
  `~/Library/Application Support/hakoniwa/world.json` に保存(開発版とアプリ版で共有)。
- **保存されないもの**(再起動でリセット): 旅人、にわとりの卵、aging の年齢、
  水たまり、虹、天気の状態。
  変更から1.2秒デバウンスして書き込み。スキーマを変えるときは `serialize()/deserialize()` と
  `v` フィールドを更新すること。

## ハマりどころ(実績あり)

- **この環境の npm は allow-scripts 制で postinstall がブロックされる。**
  electron/esbuild を入れ直したら `npm approve-scripts electron esbuild` が必要
  (package.json の `allowScripts` に記録済み)。
- **electron の zip 展開が失敗して dist が数百KBになることがある。**
  症状: `Electron failed to install correctly` や `Library not loaded: Electron Framework`。
  復旧手順は DEVELOPMENT.md のトラブルシューティング参照(キャッシュ zip から ditto で手動展開)。
- `index.html` は `dist/renderer.js` を読むので、**renderer を触ったら必ず `npm run build`**。
- CSP が `default-src 'self'` なので外部 CDN やインライン script は読めない。
- `npm run package` 時に electron-packager が `.icon`(Icon Composer 形式)の
  WARNING を出すが、icns 自体は適用されているので無視してよい。
- 環境音は Web Audio 生成(audio.js)。Electron は autoplay 制限がないので
  ユーザー操作なしで AudioContext を開始できる(ブラウザに移植するときは注意)。

## コード規約

- UI 文言・ゲーム内の名前は日本語(ひらがな中心のやわらかいトーン)。
- コメントは日本語で、コードから読み取れない意図だけを書く。
- データモデル(world.js)と描画(scene3d.js)の分離を守る。
  ゲームルールの追加は autopilot.js / world.js 側へ、見た目は scene3d.js / characters.js 側へ。
- ブロック種の追加は `config.js` の BLOCK_TYPES に足すだけでパレット・描画・保存に反映される
  (水のような特殊挙動が必要なら scene3d.js / world.js の water 分岐を参照)。
