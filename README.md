# katahimo-app

保育訪問業務Webアプリ `gas-childcare-visit-app`(Google Apps Script版)を置き換える、本格Webアプリ。
2026-09-25 に新規リポジトリとして一から作り直しを開始した(旧試作のコードは引き継いでいない)。

## 参照するもの

| 参照先 | 位置づけ |
| --- | --- |
| `legacy/gas-childcare-visit-app`(git submodule → `katahimo-dev/gas-childcare-visit-app`) | 稼働中のGAS版。**仕様の正**(画面・業務ロジック・データの読み書き先)。読み取り専用で参照し、修正はGAS版リポジトリで行う。 |
| `doc/reference/` | 旧試作(`katahimo-dev/C001-cutest-internal` の `01_GAS/katahimo-app`、Hono + Drizzle + PostgreSQL 構成)の設計資料。技術構成・DB構造の検討結果として参考にする(採否は改めて判断する)。 |
| [`ohru131/katahimo-app`](https://github.com/ohru131/katahimo-app) | 公開デモ版。UI・設計の参考。 |

旧試作のコードそのものは `katahimo-dev/C001-cutest-internal` の git 履歴(`01_GAS/katahimo-app`、2026-09-25 の移管コミットより前)に残っている。

## セットアップ

```bash
git clone --recurse-submodules https://github.com/katahimo-dev/katahimo-app.git
# 既に clone 済みなら
git submodule update --init
# GAS版の最新(main)に追従する場合。更新したら legacy/gas-childcare-visit-app の参照コミットを commit する
git submodule update --remote legacy/gas-childcare-visit-app
```

## 運用方針

- 変更履歴は `CHANGELOG.md` に記録する(`## [Ver. x.y.z] - 日付`)。
- APIキー・秘密鍵・トークンはソースへ直書きしない。
- コードコメント・README・CHANGELOG・コミットメッセージは日本語で書く。
