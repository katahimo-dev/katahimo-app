# 更新履歴 (katahimo-app)

## [Ver. 0.0.2] - 2026-09-25

- 出勤簿(過去の予定タブ)をGAS版と同じ挙動に揃えた: 当月のみ編集できる月ロック、変わった列だけの保存(`changed_fields`・変更履歴・強調表示つきミラー)、カレンダーからの反映(プレビュー/反映/冪等)、月次まとめ(全日・働いた時間・領収書集計)、勤怠集計の書き直し。
- outboxミラーの再試行(指数バックオフ・上限回数・異常終了したジョブの取り直し)と、勤怠集計(`attendance_aggregate`)のミラーを追加。
- ワーカーを常駐のoutboxポーラーと単発ジョブ(`job:nightly-calendar-sync` 22:00 / `job:csv-import` 03:00 JST)に分けた。顧客CSVの自動取込(Google Drive / ローカルディレクトリ)と `GET /api/data-version`、管理者の手動取込 `POST /api/admin/customers/import` を追加。仕様は `doc/api/attendance-batch.md`。

## [Ver. 0.0.1] - 2026-09-25

- 新規リポジトリとして作り直しを開始。GAS版を `legacy/gas-childcare-visit-app` に git submodule で取り込み、旧試作の設計資料を `doc/reference/` に置いた。
