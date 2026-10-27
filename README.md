# 幻想再帰のアリュージョニスト Wiki 2（Web公開版）

[![Deploy](https://github.com/allusionistwiki/AllusionistWiki2/actions/workflows/deploy.yml/badge.svg)](https://github.com/allusionistwiki/AllusionistWiki2/actions)

**公開サイト: https://allusionistwiki.github.io/AllusionistWiki2/**

L1〜L7 解析パイプライン（work リポジトリ）が生成する**正規化台帳・名相関索引・来歴チェーン付きの分析 Wiki** の Web 公開版です。表示（最新）層をサイト直下に、L1 下位層を `/l1/` 併存（同一構造）で配置します。[Quartz](https://quartz.jzhao.xyz/) で Obsidian vault から静的サイトとしてビルドしています。

- 階層モデル・運用則: [AllusionistWiki_work](https://github.com/allusionistwiki/AllusionistWiki_work)（全層は `work/allusionist_v2/` 配下、来歴チェーン L7→L3→L2→L1→L0）
- 下層Wiki索引: https://allusionistwiki.github.io/AllusionistWiki2/layers/
- 初代 Wiki（v1・人間編集層）: https://allusionistwiki.github.io/AllusionistWiki/

## 構成（2リポジトリ方式）

| リポジトリ | 役割 |
|---|---|
| [`AllusionistLLMWiki2_Obsidian`](https://github.com/allusionistwiki/AllusionistLLMWiki2_Obsidian) | L1 解析 vault 本体（ソース・オブ・トゥルース）。`wiki/` が Quartz の content になる |
| `AllusionistWiki2`（本リポジトリ） | Quartz プロジェクト＋GitHub Pages デプロイ設定。vault の内容は CI が取得してビルドする |

> 注意: 本リポジトリの公開対象は **Wiki 2** です。初代 Wiki（`AllusionistWiki`）のソース vault は `AllusionistWiki_obsidian` であり、両者は別系統です。README 転写由来の参照混同が過去に発生したため、構成・デプロイフローは実運用（`.github/workflows/deploy.yml`）に合わせて記載します。

## デプロイフロー

1. vault 側（`AllusionistLLMWiki2_Obsidian`）に push → または schedule / repository_dispatch 発火
2. CI が `AllusionistLLMWiki2_Obsidian` の `wiki/` を `content/` として取得（同一構造のまま `/l1/` 下位層も生成）
3. `npx quartz build` で静的サイト生成
4. GitHub Pages にデプロイ（vault の SHA が変わらなければスキップ、デプロイは vault SHA＋サイト SHA 連合マーカー `w2-deployed-v2-` で管理）

> vault 側から即時再ビルドをトリガーしたい場合は、本リポジトリの Actions → Deploy → Run workflow を手動実行する（空コミットでマーカーキーを更新する運用もあり）。

## ローカルでビルド・プレビュー

```bash
# vault の wiki/ を content/ にコピー
git clone --depth 1 https://github.com/allusionistwiki/AllusionistLLMWiki2_Obsidian.git /tmp/vault
mkdir -p content && cp -r /tmp/vault/wiki/. content/

npm ci
npx quartz build --serve   # http://localhost:8080 でプレビュー
```

## 設定

- `quartz.config.ts` — タイトル・ロケール（ja-JP）・baseUrl（`/AllusionistWiki2/`）・テーマ
- `quartz.layout.ts` — レイアウト（検索・グラフ・backlinks・TOC）
- `scripts/` — リンク解決パッチ（`/l1/` 二重配置での basename 曖昧化対策）等のデプロイ補助スクリプト
- `.github/workflows/deploy.yml` — GitHub Pages デプロイ

## License

本リポジトリは**分割ライセンス（Split Licensing）**で提供します。

| レイヤー | 対象 | ライセンス |
|---|---|---|
| A | Wiki 本文・独自解説・要約・考察・編纂物（`content/**/*.md`） | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) |
| B | コード・スクリプト・CI・設定ファイル（`quartz.config.ts`, `quartz.layout.ts`, `.github/workflows/**` 等） | [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/)（パブリックドメイン） |
| C | 原作本文・抜粋・画像・商標・フォント・第三者素材 | ライセンス対象外（各権利者の権利に従う） |
| — | 上流 OSS（Quartz 本体 `quartz/`, npm, GitHub Actions） | 各々のオリジナルライセンス |

- 詳細は [LICENSE.md](./LICENSE.md) と [NOTICE.md](./NOTICE.md) を参照してください。
- 正式な英文 legal code：[LICENSE-CC-BY-NC-SA-4.0.txt](./LICENSE-CC-BY-NC-SA-4.0.txt) / [LICENSE-CC0.txt](./LICENSE-CC0.txt)
- 上流 Quartz 本体の帰属表示は [LICENSE.txt](./LICENSE.txt)（Copyright (c) 2021 jackyzha0）に保持します。
- 本リポジトリは**非公式のファンWiki**であり、原作者・出版社・権利者とは関係ありません。
- 原作「幻想再帰のアリュージョニスト」の著作権は原作者に帰属します。
