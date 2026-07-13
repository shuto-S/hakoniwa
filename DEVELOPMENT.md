# 開発・運用ガイド

コードの構造やゲームシステムの設計は [AGENTS.md](AGENTS.md) を参照。
遊びかたは [README.md](README.md) を参照。ここには手順だけをまとめる。

## 必要環境

- macOS (Apple Silicon / arm64)
- Node.js + npm

## セットアップ

```sh
npm install
```

この環境の npm は allow-scripts 制のため、初回や入れ直し時に
electron / esbuild の postinstall がブロックされたら:

```sh
npm approve-scripts electron esbuild
npm install
```

## コマンド一覧

コードは **TypeScript**。esbuild が型を剥がしてバンドルするので、`npm run build` は
型チェックしない。型は `npm run typecheck`(`tsc --noEmit`)で別に検査する。

| コマンド | 内容 |
| --- | --- |
| `npm start` | バンドル + 開発起動(いちばんよく使う) |
| `npm run build` | レンダラーを `dist/renderer.js`、メイン/preload を `dist/main.js`・`dist/preload.js` にバンドル |
| `npm run typecheck` | `tsc --noEmit` で型を検査(esbuild は型を見ないので必須) |
| `npm run lint` | ESLint(同名シャドウ・初期化前アクセスなどを検出) |
| `npm test` | `node --test`(テストは Node ネイティブの型ストリップで `.ts` を直接読む。Node 24+) |
| `npm run smoke:electron` | 一時 userData で Electron を起動し、主要UI・キーボード操作・パレットをスモーク確認 |
| `npm run watch` | レンダラーバンドルの watch モード(別ターミナルで `npx electron .`) |
| `npm run package` | macOS アプリ(`release/つみにわ-darwin-arm64/つみにわ.app`)を生成 |

**注意: `src/renderer/`・`main.ts`・`preload.ts` を触ったら必ずビルドが必要。**
`index.html` は `dist/renderer.js` を、Electron は `dist/main.js`(`package.json` の `main`)を
読むため、ビルドせずに electron を再起動しても反映されない。

構成メモ:
- レンダラー: `src/renderer/**/*.ts` → esbuild で `dist/renderer.js`
- メイン/preload: `src/main/{main,preload,ai-service}.ts` → esbuild で `dist/*.js`
- IPC 境界の型は `src/shared/ipc.ts` に集約(preload と renderer が共有)
- `window.tsuminiwa` の型は `src/renderer/global.d.ts`

## 開発時のログ確認

```sh
ELECTRON_ENABLE_LOGGING=1 npx electron .
```

レンダラーの console.log / エラーがターミナルに出る。
動作確認の目安: 起動後しばらく走らせて `error|uncaught` が出ないこと。
昼夜・天気・季節など時間系の機能は、設定で「1日の長さ」「天気の変わる間隔」を
最短にすると早く確認できる。

## リリース(アプリの更新)手順

### 自分のMacに入れる

```sh
npm run package
ditto "release/つみにわ-darwin-arm64/つみにわ.app" "/Applications/つみにわ.app"
```

- 起動中のアプリは先に終了しておく(✕ボタン or `pkill -f つみにわ.app`)
- 署名なしのローカルビルドなので、自分の Mac で作って自分で使うぶんには
  Gatekeeper の警告は出ない(配布する場合は署名・公証が別途必要)

### GitHub Releases に公開する

タグを push すると `.github/workflows/release.yml` が macOS ランナーでパッケージし、
zip を Releases に自動添付する:

次の GitHub Actions Secrets がすべて設定されている場合は Developer ID 署名・Apple 公証・
staple まで自動で行う。未設定の場合は従来どおり署名なしでリリースする。

- `APPLE_CERTIFICATE_P12`: Developer ID Application 証明書の `.p12` を base64 化した値
- `APPLE_CERTIFICATE_PASSWORD`: `.p12` のパスワード
- `APPLE_SIGNING_IDENTITY`: `Developer ID Application: ...` の完全な名前
- `APPLE_ID`: 公証に使う Apple ID
- `APPLE_APP_PASSWORD`: App用パスワード
- `APPLE_TEAM_ID`: Apple Developer Team ID

```sh
git tag v0.2.0
git push --tags
```

ダウンロードした人は署名なしのため初回のみ右クリック→「開く」が必要。

### CI

push / PR ごとに `.github/workflows/ci.yml` が `lint → typecheck → build → test → Electron UI smoke` の通過を確認する。

## セーブデータ

- 場所: `~/Library/Application Support/tsuminiwa/world.json`
- 開発版(`npm start`)とアプリ版で**同じファイルを共有**する
- 世界・キャラクター・設定・日数・水の状態・村のきろくが入る。変更から1.2秒デバウンスで自動保存
- 一時ファイルから atomic に置き換え、直前の正常な世代を `world.backup.json` に保持する
- サイズ変更・手動リセット・AI世界生成は再生成直前のセッションをメモリに一世代だけ保持し、
  10秒間の「元にもどす」操作で復元する。連続再生成では直前の確定済み世界だけがUndo対象
- リセットしたいとき: アプリ内の「世界をつくりなおす」、
  または終了した状態で `world.json` を削除
- 手動バックアップしたいとき: `world.json` をコピーしておくだけでよい

## デモ映像(GIF + mp4)

```sh
npx electron scripts/capture-gif.js
```

使い捨ての userData でデモ用の世界を起動し(自分のセーブには触れない)、
ブロック設置と視点回転を自動操作しながら約18秒撮影して、
`docs/demo.gif`(README埋め込み用・軽量)と `docs/demo.mp4`(SNS用・高画質)を書き出す。
画面収録権限は不要。GIF は capturePage + gifenc で作り、**mp4 化にだけ ffmpeg を使う**
(`brew install ffmpeg`。無ければ GIF だけ出力)。撮影後に docs 側で
ffmpeg のパレット方式でGIFを作り直す/mp4を2倍アップスケールすると、より小さく・きれいになる。
撮影シナリオはスクリプト内の `SCENARIO` を編集する。

## アイコンの変更

元絵は `build/icon.svg`。変更したら:

```sh
cd build
qlmanage -t -s 1024 icon.svg -o .   # SVG → 1024px PNG
rm -rf icon.iconset && mkdir icon.iconset
for size in 16 32 128 256 512; do
  sips -z $size $size icon.svg.png --out icon.iconset/icon_${size}x${size}.png
  sips -z $((size*2)) $((size*2)) icon.svg.png --out icon.iconset/icon_${size}x${size}@2x.png
done
iconutil -c icns icon.iconset -o icon.icns
```

そのあと `npm run package` すれば新アイコンで焼き直される。

## トラブルシューティング

### `Electron failed to install correctly` / `Library not loaded: Electron Framework`

electron の zip 展開が不完全(dist が数百KBしかない)。zip 自体は
`~/Library/Caches/electron/` に正常に落ちていることが多いので手動展開する:

```sh
cd node_modules/electron
rm -rf dist && mkdir dist
ditto -x -k ~/Library/Caches/electron/<hash>/electron-*.zip dist/
node -e "require('fs').writeFileSync('path.txt','Electron.app/Contents/MacOS/Electron')"
```

キャッシュの zip も壊れている(小さすぎる)場合は
`rm -rf ~/Library/Caches/electron` してから `node install.js` で再取得。

### アプリが起動しない・すぐ落ちる

ターミナルから直接起動するとエラーが見える:

```sh
"/Applications/つみにわ.app/Contents/MacOS/つみにわ"
```

### セーブが壊れて起動できない

`world.json` のJSONが壊れていれば `world.backup.json` から自動復元する。
両方とも読み込めない場合は通知を出して新しい世界を生成するため、必要なら終了後に
両ファイルを退避して内容を確認する。

## そのほか

- ログイン時に自動起動したい場合:
  システム設定 → 一般 → ログイン項目 に `/Applications/つみにわ.app` を追加
- git 管理する場合、`node_modules/` `dist/` `release/` は `.gitignore` 済み。
  `build/icon.iconset` と `icon.svg.png` は中間生成物なので消してよい
