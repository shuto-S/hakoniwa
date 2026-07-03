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

| コマンド | 内容 |
| --- | --- |
| `npm start` | バンドル + 開発起動(いちばんよく使う) |
| `npm run build` | レンダラーを `dist/renderer.js` にバンドルするだけ |
| `npm run watch` | バンドルの watch モード(別ターミナルで `npx electron .`) |
| `npm run package` | macOS アプリ(`release/はこにわ-darwin-arm64/はこにわ.app`)を生成 |

**注意: レンダラー(`src/renderer/`)を触ったら必ずビルドが必要。**
`index.html` は `dist/renderer.js` を読むため、ビルドせずに electron を再起動しても反映されない。

## 開発時のログ確認

```sh
ELECTRON_ENABLE_LOGGING=1 npx electron .
```

レンダラーの console.log / エラーがターミナルに出る。
動作確認の目安: 起動後しばらく走らせて `error|uncaught` が出ないこと。
昼夜・天気・季節など時間系の機能は、設定で「1日の長さ」「天気の変わる間隔」を
最短にすると早く確認できる。

## リリース(アプリの更新)手順

```sh
npm run package
ditto "release/はこにわ-darwin-arm64/はこにわ.app" "/Applications/はこにわ.app"
```

- 起動中のアプリは先に終了しておく(✕ボタン or `pkill -f はこにわ.app`)
- 署名なしのローカルビルドなので、自分の Mac で作って自分で使うぶんには
  Gatekeeper の警告は出ない(配布する場合は署名・公証が別途必要)

## セーブデータ

- 場所: `~/Library/Application Support/hakoniwa/world.json`
- 開発版(`npm start`)とアプリ版で**同じファイルを共有**する
- 世界・キャラクター・設定・日数・水の状態が入る。変更から1.2秒デバウンスで自動保存
- リセットしたいとき: アプリ内の「世界をつくりなおす」、
  または終了した状態で `world.json` を削除
- バックアップしたいとき: `world.json` をコピーしておくだけでよい

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
"/Applications/はこにわ.app/Contents/MacOS/はこにわ"
```

### セーブが壊れて起動できない

読み込み失敗時は自動で新しい世界を生成するフォールバックがあるが、
念のため `world.json` を退避 → 削除して起動し直すと確実。

## そのほか

- ログイン時に自動起動したい場合:
  システム設定 → 一般 → ログイン項目 に `/Applications/はこにわ.app` を追加
- git 管理する場合、`node_modules/` `dist/` `release/` は `.gitignore` 済み。
  `build/icon.iconset` と `icon.svg.png` は中間生成物なので消してよい
