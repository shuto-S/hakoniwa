// ESLint(flat config)。目的は「同名シャドウ・初期化前アクセス(TDZ)」の再発防止。
// 以前、翻訳関数 t がアニメーション用の局所 const t に隠され、t('...') が TDZ 例外になって
// ゲームループごと停止する事故があった。no-shadow / no-use-before-define でこの種のバグを
// CI で機械的に落とす。型そのものの検査は tsc(npm run typecheck)に任せ、ESLint は
// バグを生みやすいパターンに絞る。no-explicit-any 等のスタイル系は入れない
// (Three.js の内部型や AI の動的データで any を意図的に使うため)。
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const globals = require('globals');

// TS 用の危険パターン検出ルール(base ルールは TS 版に置き換える)
const tsGuardRules = {
  'no-undef': 'off', // 型・グローバルの解決は tsc に任せる(base だと誤検知する)
  'no-unused-vars': 'off',
  '@typescript-eslint/no-unused-vars': [
    'warn',
    { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
  ],
  'no-shadow': 'off',
  '@typescript-eslint/no-shadow': 'error',
  'no-use-before-define': 'off',
  '@typescript-eslint/no-use-before-define': [
    'error',
    { functions: false, classes: false, variables: true },
  ],
};

// 素の JS(スクリプト・テスト・この設定ファイル)用
const jsGuardRules = {
  'no-shadow': 'error',
  'no-use-before-define': ['error', { functions: false, classes: false, variables: true }],
  'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
};

module.exports = tseslint.config(
  { ignores: ['dist/**', 'release/**', 'node_modules/**'] },
  js.configs.recommended,

  // TypeScript(レンダラー = ブラウザ環境。shared は型のみだがここに含める)
  {
    files: ['src/renderer/**/*.ts', 'src/shared/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: tsGuardRules,
  },

  // TypeScript(メインプロセス・preload・AI サービス = Node 環境)
  {
    files: ['src/main/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: tsGuardRules,
  },

  // テスト(Node・ESM)
  {
    files: ['test/**/*.mjs'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node } },
    rules: jsGuardRules,
  },

  // スクリプト・この設定ファイル(Node・CommonJS)
  {
    files: ['scripts/**/*.js', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: { ...globals.node } },
    rules: jsGuardRules,
  },
);
