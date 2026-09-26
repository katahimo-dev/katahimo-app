# doc/partner — お客様(キューテスト様)向けの説明資料

| ファイル | 内容 |
| --- | --- |
| `新アプリ切替のご説明_キューテスト様.pptx` | GAS版から新アプリへの切り替えを、管理者の方向けにやさしい言葉で説明するスライド(21枚、16:9)。発表者用のメモを各スライドのノートに入れてある |
| `新アプリ切替のご説明_キューテスト様.pdf` | 上の PDF 版(フォント埋め込み済み。スマホでの閲覧・配布用) |
| `build_deck.py` | スライドを作るスクリプト(python-pptx)。文言・レイアウトはここを直して作り直す |
| `.build/`・`preview/` | 切り出した画面の画像・確認用のスライド画像(gitignore 済み) |

## 作り直し方

```bash
pip install python-pptx pillow pymupdf           # pymupdf は確認用の画像を作るときだけ
# 1. 画面の見比べ画像を撮る(架空のデータ。tools/gas-preview/out/ に出る)
cd tools/gas-preview && npx tsx src/shoot.ts --only '^(login|schedule-today|customer-detail|report-daily-result|att-week-list)$' && cd -
# 2. スライドを作る
python3 doc/partner/build_deck.py
# 3. PDF にする(LibreOffice Impress が必要。Debian/Ubuntu は libreoffice-impress)
soffice --headless --convert-to pdf --outdir doc/partner doc/partner/新アプリ切替のご説明_キューテスト様.pptx
# 4. 確認用の画像(任意)
python3 -c "import pymupdf; d=pymupdf.open('doc/partner/新アプリ切替のご説明_キューテスト様.pdf'); [p.get_pixmap(dpi=80).save(f'doc/partner/preview/s{i+1:02d}.png') for i,p in enumerate(d)]"
```

スライドの枚数を変えたら `build_deck.py` の `TOTAL`(ページ番号の分母)も直す(違うと止まる)。

- フォントは **IPA Pゴシック**(`IPAPGothic`、Debian/Ubuntu は `fonts-ipafont-gothic`)。PDF には埋め込まれる。
  PowerPoint で開く端末に無い場合は代わりのフォントで表示される(MS Pゴシックと字幅が同じため、崩れは小さい)。
- 画面の画像は `tools/gas-preview` の撮影結果(`<場面>.gas.png` / `.web.png`)を上から切り出して使う
  (ログインだけ上を少し切る。`CROP_TOP`)。人物・住所は `tools/gas-preview/src/fixtures.ts` の架空のもの。

## 内容の出典(2026-09 時点)

資料の記述は次の資料・実装に合わせてある。仕様が変わったら資料も直す。

| スライド | 出典 |
| --- | --- |
| 3 いまの課題 | `doc/07` 2章・10.2節(6分の実行制限)、GAS版 `CLAUDE.md` / `README.md`(IDの散在・LockService・`ANYONE_ANONYMOUS`) |
| 4 全体図 | `README.md`「構成」、`doc/11` 1章(Cloud Run asia-northeast1 = 東京) |
| 5〜7 画面 | `tools/gas-preview`(124場面、差分 0.05% 以下)、`packages/web/README.md`「GAS版と意図的に変えているところ」 |
| 8〜11 良くなること | `CLAUDE.md`(RLS・暗号化・UoW・楽観ロック・月ロック)、`doc/api/*.md`(レート制限・パスワード再設定・領収書の重複・顧客CSVの20%の歯止め)、`packages/core/src/domain/pii/encryptionPurposes.ts`(暗号化する項目)、`doc/11` 5章(監視・アラート) |
| 12 将来 | `doc/10`(マッチング用のテーブルのみ。アプリは未作成) |
| 13 変わること | `README.md`「GAS版のトリガー」(`gas-root-serach` の `main()` = LINE WORKS 通知は代替なし)、`MIRROR_TO_GOOGLE_SHEETS`(既定 off) |
| 14〜15 移行・切替日 | `doc/11` 7章「GAS版からの切替チェックリスト」 |
| 16 戻し方 | `doc/11` 5章「ロールバック」(直前のリビジョン、PITR 7日・自動バックアップ14世代) |
| 17 お願い | `doc/11` 3.5節・7章「切替前」 |
| 18 費用 | `doc/11` 6章(ドル建ての目安を 1ドル=150円で換算。Maps は `doc/api/schedule-route.md` 11章)、予算アラート(`monitoring.tf`、既定 30,000円) |
| 19〜20 よくある質問 | `doc/api/auth-reports-settings.md`「スタッフ台帳の取込」(GAS版のパスワードハッシュは初回ログインで argon2id に移行) |
| 21 次のステップ | `README.md`「まだ無いもの」、`doc/11` 3.10節・8章 |

まだ済んでいないこと(本番の GCP 環境の構築、本番テナントと最初の管理者を作る手順、スタッフの自宅住所の登録、
GAS側 `Bridge.js` の書き込み action の配置)は、資料では「切替前に行う準備」として書いている。
実在の方の氏名・メールアドレス・ID は載せない(役割名で書く)。
