"""キューテスト様向け「訪問業務アプリのしくみ(システム概要のご説明)」スライドを作る。

使い方(doc/partner/README.md):
    python3 doc/partner/build_overview_deck.py
    (PDF) soffice --headless --convert-to pdf --outdir doc/partner doc/partner/システム概要のご説明_キューテスト様.pptx

内容は doc/01_システム概要.md(5章 主な設計判断を含む)を、IT に詳しくない方向けの言葉に直したもの。
画面の画像は使わない(撮影の準備なしで作り直せる)。
"""

from __future__ import annotations

from pathlib import Path

from deck_lib import *  # noqa: F403(デザインの決まり・部品)

HERE = Path(__file__).resolve().parent
OUT = HERE / "システム概要のご説明_キューテスト様.pptx"

TOTAL = 20
FOOTER = "訪問業務アプリのしくみ(システム概要)|株式会社キューテスト様"

deck = Deck(TOTAL, FOOTER)
new_slide = deck.new_slide
page_ref = deck.page_ref
SOFT = RGBColor(0xB5, 0xD8, 0xD6)  # 濃い地の上の補足
PALE = RGBColor(0xDD, 0xF0, 0xEE)  # 濃い地の上の本文
DARK_CARD = RGBColor(0x17, 0x62, 0x6F)  # 濃い地の上のカード


def grid(s, items, cols, top, card_h, head_size=21, body_size=16, gap_y=0.22):
    """(アイコンの1文字, 見出し, 本文) のカードを cols 列で並べる。"""
    w = (12.13 - (cols - 1) * 0.25) / cols
    for i, (ic, head, body) in enumerate(items):
        col, row = i % cols, i // cols
        x, y = 0.6 + col * (w + 0.25), top + row * (card_h + gap_y)
        card(s, x, y, w, card_h)
        badge(s, x + 0.25, y + 0.25, 0.6, ic, size=19)
        text(s, x + 1.0, y + 0.25, w - 1.15, 0.6, head, size=head_size, color=DEEP, bold=True, anchor=MSO_ANCHOR.MIDDLE)
        text(s, x + 0.25, y + 1.0, w - 0.45, card_h - 1.1, body, size=body_size, line=1.2)


def decisions(s, rows):
    """主な設計の判断: (決めたこと, なぜ, 引き換えに) の表。"""
    heads = ("決めたこと", "なぜ", "引き換えに(ご不便・手間)")
    xs, ws = (0.6, 4.35, 8.6), (3.6, 4.1, 4.13)
    for x, w, h in zip(xs, ws, heads):
        card(s, x, 1.5, w, 0.5, fill=DEEP, radius=0.15)
        text(s, x, 1.5, w, 0.5, h, size=17, color=WHITE, bold=True, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    for i, row in enumerate(rows):
        y = 2.12 + i * 1.2
        for j, (x, w, t) in enumerate(zip(xs, ws, row)):
            card(s, x, y, w, 1.08, fill=TINT2 if j == 0 else TINT)
            text(s, x + 0.18, y, w - 0.3, 1.08, t, size=17 if j == 0 else 15, color=DEEP if j == 0 else INK,
                 bold=j == 0, anchor=MSO_ANCHOR.MIDDLE, line=1.15, space_after=0)


# =============================================================================
# 1. 表紙
s = new_slide(dark=True)
badge(s, 0.9, 1.2, 0.9, "図", fill=TEAL, size=30)
text(s, 0.9, 2.4, 11.5, 1.8, ["訪問業務アプリのしくみ", "(システム概要のご説明)"], size=44, color=WHITE, bold=True,
     line=1.1, space_after=2)
text(s, 0.9, 4.45, 11, 0.6, "株式会社キューテスト様向け ご説明資料", size=24, color=RGBColor(0xCF, 0xEB, 0xE8))
text(s, 0.9, 5.2, 11, 0.5, "2026年9月", size=20, color=SOFT)
text(s, 0.9, 6.35, 11.5, 0.5, "新しい訪問業務アプリが「何を・どのように」行っているかを、専門用語を使わずにご説明します",
     size=16, color=SOFT)
notes(s, "本日は、新しい訪問業務アプリの全体像をご説明します。切り替えの進め方は、別の資料「新しい訪問業務アプリへの"
         "切り替えについて」でご説明しています。")

# 2. この資料について
s = new_slide("この資料について", kicker="はじめに")
rows = [
    ("目", "目的", "新しいアプリが何をしていて、記録をどう守っているかを、全体としてつかんでいただくこと。"),
    ("対", "対象", "経営・事務局のご担当者さま。ITの知識は前提にしていません。"),
    ("※", "言葉", f"「※」の付いた言葉は、巻末の用語解説({page_ref('glossary1')}〜{page_ref('glossary2')}ページ)で説明しています。"),
    ("別", "別の資料", "切り替えの手順・日程・費用は「新しい訪問業務アプリへの切り替えについて」をご覧ください。"),
]
for i, (ic, head, body) in enumerate(rows):
    y = 1.55 + i * 1.3
    card(s, 0.6, y, 12.13, 1.12)
    badge(s, 0.85, y + 0.24, 0.64, ic, size=20)
    text(s, 1.75, y, 2.0, 1.12, head, size=22, color=DEEP, bold=True, anchor=MSO_ANCHOR.MIDDLE)
    text(s, 3.6, y, 8.9, 1.12, body, size=18, anchor=MSO_ANCHOR.MIDDLE, line=1.2)
notes(s, "この資料は、システムの設計書(doc/01 システム概要)の内容を、ITに詳しくない方向けの言葉に直したものです。")

# 3. ひとことで言うと
s = new_slide("ひとことで言うと", kicker="全体像")
card(s, 0.6, 1.45, 12.13, 0.95, fill=TINT2)
text(s, 0.9, 1.45, 11.6, 0.95, "訪問スタッフがスマホで使う、訪問の仕事をまとめて扱うアプリです",
     size=22, color=DEEP, bold=True, anchor=MSO_ANCHOR.MIDDLE)
features = [
    ("予", "予定と道順", "今日・明日の訪問予定と、訪問先への道順・移動時間"),
    ("客", "お客様の情報", "住所・連絡先・お子様の情報と、これまでの記録"),
    ("報", "日報・事故報告", "日報・事故報告・ヒヤリハット。日報はAI※が下書き"),
    ("領", "領収書", "写真を撮るだけで、AIが金額・お店を読み取って登録"),
    ("勤", "出勤簿", "予定から自動で記入。月・年度ごとにExcelで保存"),
    ("知", "スマホへのお知らせ", "前の晩に、明日の予定をスマホに通知(プッシュ通知※)"),
]
grid(s, features, 3, 2.65, 1.95, body_size=16)
notes(s, "スタッフの皆さまが毎日使う機能は、今のアプリとほぼ同じです。新しく加わったのは、スマホへのお知らせと管理者の画面です。"
         "スマホではPWA※(ホーム画面に追加して使うWebページ)として使います。")

# 4. 使う人と役割
s = new_slide("使う人と役割(できることの範囲)", kicker="全体像")
roles = [
    ("ス", "スタッフ", ["自分の予定・出勤簿・日報・領収書", "全てのお客様の情報と記録を見る(今と同じ)"]),
    ("コ", "コーディネーター", ["スタッフのできることに加えて", "他のスタッフの予定・出勤簿・日報・領収書を扱う", "全員分の報告の一覧・書き出し"]),
    ("管", "管理者", ["コーディネーターのできることに加えて", "スタッフの登録・変更・退職", "AIの設定・操作ログ※の確認"]),
]
w = (12.13 - 2 * 0.25) / 3
for i, (ic, head, items) in enumerate(roles):
    x = 0.6 + i * (w + 0.25)
    card(s, x, 1.55, w, 4.1, fill=TINT2 if i == 2 else TINT)
    badge(s, x + 0.3, 1.8, 0.7, ic, size=22)
    text(s, x + 1.15, 1.8, w - 1.3, 0.7, head, size=24, color=DEEP, bold=True, anchor=MSO_ANCHOR.MIDDLE)
    bullets(s, x + 0.3, 2.8, w - 0.55, 2.8, items, size=17, gap=8)
text(s, 0.6, 5.85, 12.13, 0.9, [
    [("役割※の確かめは、画面だけでなくアプリ本体※が毎回行います。", {"bold": True, "color": DEEP})],
    "スタッフが他の人のデータを開こうとしても、本人のデータしか返しません。会社の登録などは開発側の担当者だけが行います。",
], size=16, line=1.2, space_after=2)
notes(s, "役割は3つです。画面で見えるボタンが違うだけでなく、アプリ本体が操作のたびに役割を確かめるので、"
         "画面を細工しても権限の外の操作はできません。")

# 5. スタッフの1日
s = new_slide("スタッフの1日とアプリ", kicker="使われ方")
steps = [
    ("前日 19:00", "予定のお知らせ", "明日の訪問の時刻とお名前がスマホに届く"),
    ("当日の朝", "予定と道順を見る", "予定はGoogleカレンダーから。道順と移動時間も出る"),
    ("訪問の後", "日報・領収書", "メモからAIが日報を下書き。領収書は写真を送るだけ"),
    ("夜 22:00", "出勤簿に自動で記入", "その日の予定から訪問・移動の時間を出勤簿に入れる"),
    ("月末", "出勤簿を保存", "今月のまとめを確かめ、Excelで保存"),
]
tl_y = 2.35
arrow(s, 0.9, tl_y, 12.5, tl_y, color=MID, width=3)
w = 2.3
for i, (when, head, body) in enumerate(steps):
    x = 0.6 + i * (w + 0.15)
    badge(s, x + w / 2 - 0.3, tl_y - 0.3, 0.6, str(i + 1), size=20)
    text(s, x, 1.45, w, 0.45, when, size=17, color=TEAL, bold=True, align=PP_ALIGN.CENTER)
    card(s, x, 2.95, w, 3.0)
    text(s, x + 0.2, 3.1, w - 0.4, 0.9, head, size=18, color=DEEP, bold=True, line=1.1)
    text(s, x + 0.2, 4.05, w - 0.4, 1.85, body, size=16, line=1.25)
text(s, 0.6, 6.15, 12.13, 0.6, f"※ 出勤簿は今月の分だけ直せます。締めた月は変わりません(記録の正確さ、{page_ref('accuracy')}ページ)。",
     size=15, color=MUTED)
notes(s, "スタッフの1日の流れに沿って、アプリがどこで何をしているかを示しました。19時・22時の処理は自動で動きます。")

# 6. 管理者の画面
s = new_slide("管理者・コーディネーターの画面(🛠 管理)", kicker="使われ方")
admin = [
    ("人", "スタッフ", "登録・変更・退職日・削除。パスワード設定の案内メール"),
    ("覧", "報告一覧", "全員分の日報・事故報告を絞り込んで見る・書き出す(コーディネーターも)"),
    ("指", "AIへの指示文", "AIが日報を書くときの指示文を直す。既定に戻すことも"),
    ("語", "日報AIの調整", "教育の言葉の表(キーワード表)を取り込み・直す"),
    ("録", "操作ログ", "誰が・いつ・何をしたかを期間などで絞り込んで見る"),
    ("表", "出勤簿のExcel", "全員分の出勤簿を1つのファイルで保存"),
]
grid(s, admin, 3, 1.55, 2.2, body_size=16)
text(s, 0.6, 6.4, 12.13, 0.45, "今はスプレッドシートを直接開いて行っている管理の作業を、アプリの画面で行えるようにしました。",
     size=16, color=MUTED)
notes(s, "報告一覧はコーディネーターも使えます。それ以外は管理者だけです。スタッフの登録で自宅の住所を入れると、"
         "道順の出発点として使います。")

# 7. 日報AIのしくみ
s = new_slide("日報AIのしくみ", kicker="使われ方")
inputs = [
    ("齢", "お子様の年齢", "年齢に合う言葉・場面を選ぶ"),
    ("★", "ご家庭の教育への関心", "教育思考★※(★1〜5)に合わせて言葉の専門度を変える"),
    ("P", "保護者のストレス度", "PSI※(5〜1)が低いほど、専門的な言葉を控え寄り添う言葉に"),
]
for i, (ic, head, body) in enumerate(inputs):
    y = 1.55 + i * 1.4
    card(s, 0.6, y, 5.6, 1.25)
    badge(s, 0.85, y + 0.3, 0.64, ic, size=20)
    text(s, 1.7, y + 0.1, 4.4, 0.5, head, size=19, color=DEEP, bold=True)
    text(s, 1.7, y + 0.58, 4.4, 0.65, body, size=15, line=1.15)
arrow(s, 6.35, 3.4, 7.15, 3.4, width=4)
card(s, 7.3, 1.55, 5.43, 4.05, fill=DEEP)
text(s, 7.6, 1.75, 4.9, 0.55, "AIが日報の下書きを作る", size=22, color=WHITE, bold=True)
bullets(s, 7.6, 2.45, 4.9, 3.1, [
    "会社の言葉の表(キーワード表)から、3つの条件に合う言葉だけを渡す",
    "スタッフが確かめて直してから保存する",
    "AIに送った内容と答えを記録に残す",
], size=17, gap=8, mark_color=MID, color=WHITE)
card(s, 0.6, 5.85, 12.13, 0.95, fill=TINT2)
text(s, 0.9, 5.85, 11.6, 0.95, [
    [("PSI 2・1 の日報を保存すると、", {"bold": True, "color": DEEP}),
     ("管理者のスマホとGoogle Chatに自動で知らせます(PSI 1 は「管理者へ連絡」の注意も出します)。", {})],
], size=17, anchor=MSO_ANCHOR.MIDDLE)
notes(s, "言葉の選び方の規則は、キューテスト様の「日報キーワード表現マスター」の使い方のとおりです。規則はアプリ本体に"
         "組み込み、言葉の表は管理者が画面から取り込み・直せます。AIはGoogleのGemini※です。")

# 8. 全体のしくみ
s = new_slide("全体のしくみ", kicker="しくみ")
card(s, 0.6, 2.2, 2.9, 2.4)
text(s, 0.6, 2.35, 2.9, 0.6, "スマホ・パソコン", size=21, color=DEEP, bold=True, align=PP_ALIGN.CENTER)
text(s, 0.8, 3.0, 2.5, 1.5, "スタッフ・事務局の皆さま\nPWA※としてホーム画面から使う", size=15, color=MUTED,
     align=PP_ALIGN.CENTER, line=1.2)
arrow(s, 3.6, 3.4, 4.3, 3.4, width=4)
card(s, 4.4, 1.55, 3.9, 4.9, fill=TINT2)
text(s, 4.4, 1.62, 3.9, 0.45, "Google Cloud※(東京)", size=16, color=TEAL, bold=True, align=PP_ALIGN.CENTER)
card(s, 4.7, 2.15, 3.3, 1.5, fill=DEEP)
text(s, 4.7, 2.2, 3.3, 0.6, "アプリ本体※", size=21, color=WHITE, bold=True, align=PP_ALIGN.CENTER)
text(s, 4.8, 2.8, 3.1, 0.8, "操作を受けて記録を読み書き\n夜の自動処理も", size=14, color=PALE, align=PP_ALIGN.CENTER)
arrow(s, 6.35, 3.7, 6.35, 4.3, width=3)
card(s, 4.7, 4.4, 3.3, 1.8, fill=DEEP)
text(s, 4.7, 4.5, 3.3, 0.6, "データベース※", size=21, color=WHITE, bold=True, align=PP_ALIGN.CENTER)
text(s, 4.8, 5.1, 3.1, 1.0, "記録の正本※をまとめて保管\n(暗号化※・バックアップ※)", size=14, color=PALE, align=PP_ALIGN.CENTER)
ext = [
    ("Googleカレンダー", "訪問の予定"),
    ("Googleマップ", "道順・移動時間"),
    ("Gemini(AI)", "日報の下書き・領収書の読み取り"),
    ("Google Chat", "社内へのお知らせ"),
    ("RESERVA※", "お客様の情報のCSV※"),
    ("スプレッドシート", "今の表への写し※(使うときだけ)"),
]
for i, (head, body) in enumerate(ext):
    y = 1.55 + i * 0.83
    card(s, 9.1, y, 3.63, 0.72)
    text(s, 9.3, y, 1.9, 0.72, head, size=15, color=DEEP, bold=True, anchor=MSO_ANCHOR.MIDDLE, line=1.0)
    text(s, 11.05, y, 1.6, 0.72, body, size=12, color=MUTED, anchor=MSO_ANCHOR.MIDDLE, line=1.05, space_after=0)
arrow(s, 8.4, 3.9, 9.0, 3.9, width=4)
text(s, 0.6, 6.55, 12.13, 0.4, "外のサービスとは、アプリ本体だけがつながります。スマホから直接つながることはありません。",
     size=15, color=MUTED)
notes(s, "アプリ本体とデータベースは、Googleのデータセンター(東京)で動きます。予定はGoogleカレンダー、道順はGoogleマップ、"
         "AIはGeminiを使います。今のアプリで使っていたスプレッドシートへは、必要な間だけ一方向の写しを書き込めます。")

# 9. データの流れ
s = new_slide("データの流れ ― 正本は1か所", kicker="しくみ")
cols = [
    ("入ってくるもの", [
        ("お客様の情報", "RESERVAのCSVを10分ごとに取り込む(アプリの画面では直さない)"),
        ("訪問の予定", "Googleカレンダーから読む"),
        ("日報・領収書など", "スタッフが入力する"),
    ]),
    ("出ていくもの", [
        ("スプレッドシートへの写し", "一方向だけ。シートを直してもアプリには戻らない"),
        ("Excel・CSVの書き出し", "出勤簿・報告・領収書・操作ログ"),
        ("お知らせ", "スマホの通知・Google Chat・メール"),
    ]),
]
for ci, (head, items) in enumerate(cols):
    x = 0.6 if ci == 0 else 8.43
    text(s, x, 1.45, 4.3, 0.45, head, size=19, color=TEAL, bold=True)
    for i, (h, b) in enumerate(items):
        y = 1.95 + i * 1.5
        card(s, x, y, 4.3, 1.35)
        text(s, x + 0.2, y + 0.1, 3.9, 0.45, h, size=18, color=DEEP, bold=True)
        text(s, x + 0.2, y + 0.55, 3.9, 0.8, b, size=15, line=1.15)
arrow(s, 5.0, 3.9, 5.25, 3.9, width=4)
card(s, 5.35, 2.4, 2.63, 3.0, fill=DEEP)
text(s, 5.35, 2.6, 2.63, 0.6, "データベース", size=21, color=WHITE, bold=True, align=PP_ALIGN.CENTER)
text(s, 5.5, 3.25, 2.33, 2.1, "記録の正本※は\nここ1か所だけ\n\n他は全て写し", size=17, color=PALE,
     align=PP_ALIGN.CENTER, line=1.2)
arrow(s, 8.08, 3.9, 8.33, 3.9, width=4)
text(s, 0.6, 6.5, 12.13, 0.4, "正本が1か所なので、「どれが正しい記録か」で迷いません。", size=16, color=DEEP, bold=True)
notes(s, "今のアプリでは、スプレッドシートそのものが記録の置き場でした。新しいアプリでは、記録の正本はデータベースだけで、"
         "スプレッドシートは移行の間の写しです。お客様の情報はRESERVAからの取り込みでだけ変わります。")

# 10. 自動で動く処理
s = new_slide("自動で動く処理(人の操作なしで毎日動く)", kicker="しくみ")
jobs = [
    ("19:00", "明日の予定のお知らせ", "通知をオンにしたスタッフのスマホに、明日の予定を送る"),
    ("22:00", "出勤簿への反映", "その日の予定を、全スタッフの出勤簿に入れる"),
    ("04:00", "整理", "保存の期限を過ぎた記録や使われなくなったファイルを片付ける"),
    ("10分ごと", "お客様の情報の取り込み", "RESERVAの新しいCSVを取り込む。お客様が2割を超えて消えるときは止めて確認を待つ"),
    ("10分ごと", "送り直しの見回り", "届かなかったお知らせ・写しを送り直す"),
]
for i, (when, head, body) in enumerate(jobs):
    y = 1.5 + i * 1.02
    card(s, 0.6, y, 12.13, 0.9)
    card(s, 0.6, y, 1.9, 0.9, fill=DEEP)
    text(s, 0.6, y, 1.9, 0.9, when, size=20, color=WHITE, bold=True, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    text(s, 2.75, y, 3.4, 0.9, head, size=19, color=DEEP, bold=True, anchor=MSO_ANCHOR.MIDDLE)
    text(s, 6.2, y, 6.4, 0.9, body, size=15, anchor=MSO_ANCHOR.MIDDLE, line=1.15)
text(s, 0.6, 6.7, 12.13, 0.3, "時刻は日本時間。お知らせ・写しは、ふだんは操作の10〜30秒後に届きます。", size=14, color=MUTED)
notes(s, "夜の処理は、今はApps Script※の時間の決まり(トリガー)で動いているものの置き換えです。19時の予定のお知らせは、"
         "今のLINE WORKSのメッセージの置き換えです。")

# 11. データの守り方① 見える範囲
s = new_slide("データの守り方① ― 見える範囲を絞る", kicker="安全")
guard1 = [
    ("社", "会社ごとの仕切り", "複数の会社が使っても、データベース自体が他の会社のデータを見せない・書かせない"),
    ("役", "役割ごとの制限", "スタッフ・コーディネーター・管理者で、見られる・直せる範囲を分ける"),
    ("本", "なりすましを防ぐ", "「誰の記録か」はログインした人から決める。画面から送られた名前は信用しない"),
    ("見", "閲覧の記録", "お客様の情報を開いたこと、他の人のデータを見たことを記録に残す"),
]
grid(s, guard1, 2, 1.55, 2.3, head_size=21, body_size=17, gap_y=0.25)
notes(s, "今のアプリでは、画面から送られたスタッフ名をそのまま信じていたため、他の人の日報を上書きできました。"
         "新しいアプリではログインした本人から決め、役割もアプリ本体が毎回確かめます。")

# 12. データの守り方② 保管とログイン
s = new_slide("データの守り方② ― 保管とログイン", kicker="安全")
guard2 = [
    ("鍵", "保管場所ごとの暗号化", "データベースとバックアップ、領収書の写真を、このアプリ専用の鍵※で暗号化"),
    ("封", "大事な設定は個別に封", "AIの利用キーやGoogle Chatの送り先は、値そのものも鍵で封をして保管"),
    ("P", "パスワードの保管", "元に戻せない形で保管。今のパスワードのまま新しいアプリにログインできる"),
    ("回", "ログインの回数制限", "何度も間違えると一時的に止める(当てずっぽうの総当たりを防ぐ)"),
]
grid(s, guard2, 2, 1.55, 2.3, head_size=21, body_size=17, gap_y=0.25)
notes(s, "保存データの暗号化は、医療・介護の情報の取り扱いの指針(3省2ガイドライン)で一般的な水準に合わせています"
         "(準拠の認証を受けたという意味ではありません)。")

# 13. 記録の正確さ
s = new_slide("記録の正確さを保つ工夫", kicker="正確さ")
deck.page_of["accuracy"] = deck.page
accuracy = [
    ("同", "同時に直したとき", "後から保存した人に「読み直してください」と知らせ、黙って上書きしない"),
    ("締", "締めた月は固定", "出勤簿は今月の分だけ直せる。締めた月・記録はデータベースが変更を断る"),
    ("領", "領収書は消さない", "会計の記録なので削除はできない。直すときは取り消して登録し直す"),
    ("重", "重複を見つける", "同じ領収書を2回送っても、2件目は登録しない"),
    ("計", "計算は今と同じ", "今のアプリのプログラムを実際に動かし、計算結果が同じかを機械で確かめる"),
    ("止", "取り込みの歯止め", "お客様の情報が大きく消える取り込みは止めて、確認を待つ"),
]
grid(s, accuracy, 3, 1.55, 2.3, body_size=16)
notes(s, "出勤簿の計算・予定の分類・道順は、今のアプリのプログラムを試験の中で動かして、新しいアプリと結果が同じかを確かめています。")

# 14〜15. 主な設計の判断
s = new_slide("主な設計の判断(1)", kicker="なぜこの作りか")
decisions(s, [
    ("記録の正本はデータベース1か所。シートは写し", "同時の保存・決まりの確認・変更の履歴を、確実に守れる",
     "スプレッドシートを直しても、アプリには反映されない"),
    ("複数の会社を1つの仕組みで扱い、データベースで仕切る", "会社ごとに作るより運用が軽く、仕切りの設定し忘れでも他社のデータは見えない",
     "開発側の手間が増える(自動の試験で毎回確かめる)"),
    ("保管場所ごとの暗号化に、権限・記録・回数制限を組み合わせる", "医療・介護で一般的な水準。検索や集計をそのまま使え、作りが単純になる",
     "権限のある担当者には中身が見える(操作の記録で見張る)"),
    ("外への送信は「送る予定の箱」にためてから送る", "保存と送信を切り離し、失敗しても自動で送り直せる",
     "お知らせは操作から数十秒遅れて届く"),
])
notes(s, "設計書(doc/01 5章「主な設計判断」)から、キューテスト様に関わりの大きいものを選んで、言葉を直しました。"
         "「引き換えに」は、その作りを選んだことで受け入れた不便や手間です。")

s = new_slide("主な設計の判断(2)", kicker="なぜこの作りか")
decisions(s, [
    ("お客様の情報はRESERVAからだけ取り込む", "正本はRESERVA。アプリでも直すと、次の取り込みで上書きされ食い違う",
     "直すときはRESERVA側で直し、取り込み(10分ごと。急ぐときは「今すぐ取り込む」)を待つ"),
    ("お知らせはLINE WORKSからスマホの通知へ", "外部のアカウントや連携なしで届く。送るのは時刻とお名前だけ",
     "スマホごとに通知をオンにする。iPhoneはホーム画面への追加が要る"),
    ("領収書は削除・編集をさせず、取り消しだけ", "会計の記録が消えない・書き換わらないことを仕組みで守る",
     "直すときは取り消して登録し直す手間がかかる"),
    ("使った分だけの費用の仕組み(Google Cloud)", "使っていない時間の費用がかからない",
     "しばらく使わなかった後の最初の表示は、少し待つことがある"),
])
notes(s, "iPhoneで通知を受けるには、iOS 16.4以降で、アプリをホーム画面に追加する必要があります。")

# 16. 今のアプリとの関係
s = new_slide("今のアプリとの関係", kicker="今のアプリ")
rel = [
    ("画", "画面", "今の画面を出発点に作り、慣れたスタッフがそのまま使える。改良は新しいアプリの中で行う"),
    ("計", "計算の結果", "出勤簿の計算・予定の分類・道順は、今のアプリと同じ結果になることを機械で確かめる"),
    ("中", "中身", "記録の置き場・守り方・動かし方は作り直し。今のアプリの弱いところは直した"),
]
for i, (ic, head, body) in enumerate(rel):
    y = 1.55 + i * 1.35
    card(s, 0.6, y, 12.13, 1.18)
    badge(s, 0.85, y + 0.27, 0.64, ic, size=20)
    text(s, 1.75, y, 2.2, 1.18, head, size=22, color=DEEP, bold=True, anchor=MSO_ANCHOR.MIDDLE)
    text(s, 3.8, y, 8.7, 1.18, body, size=18, anchor=MSO_ANCHOR.MIDDLE, line=1.2)
card(s, 0.6, 5.7, 12.13, 1.05, fill=TINT2)
text(s, 0.9, 5.7, 11.6, 1.05, [
    [("目標: ", {"bold": True, "color": DEEP}), ("今のアプリでできることは全てでき、そのうえで良くなっていること。", {})],
    "機能ごとの比べ(同じ・良くなった・変わった)は、開発側の資料「GAS版との機能比較」にまとめています。",
], size=16, anchor=MSO_ANCHOR.MIDDLE, line=1.2, space_after=2)
notes(s, "今のアプリはGAS※(Apps Script)で作られています。直した弱いところの例: 他の人の日報を上書きできた、"
         "大事な設定を画面にそのまま返していた、など。")

# 17. まだ無いもの・これから
s = new_slide("まだできていないこと・これから", kicker="今後")
todo = [
    ("本", "本番の環境", "設計図(設定のファイル)はできている。Google Cloudでの構築と確認はこれから(切り替えの前に行う)"),
    ("客", "アプリでのお客様の管理", "今はRESERVAからの取り込みだけ。RESERVAからの自動の反映も今後"),
    ("割", "スタッフの割り振り", "管理者がスタッフを訪問に割り振る機能。データの入れ物だけ用意してある"),
    ("G", "Googleアカウントでのログイン", "今はメールアドレスとパスワードでログイン"),
    ("二", "管理者の二段階の確認", "パスワードに加えてもう1つで本人を確かめる仕組み(多要素認証)"),
]
for i, (ic, head, body) in enumerate(todo):
    y = 1.5 + i * 1.04
    card(s, 0.6, y, 12.13, 0.92)
    badge(s, 0.85, y + 0.17, 0.58, ic, size=18)
    text(s, 1.7, y, 3.6, 0.92, head, size=19, color=DEEP, bold=True, anchor=MSO_ANCHOR.MIDDLE)
    text(s, 5.3, y, 7.25, 0.92, body, size=15, anchor=MSO_ANCHOR.MIDDLE, line=1.15)
notes(s, "できていないことを、できていることと混ぜずにお伝えします。割り振りの機能は、データの入れ物(表)だけがあり、"
         "画面と処理はまだありません。")

# 18〜19. 用語解説
glossary = [
    [
        ("アプリ本体(サーバー)", "スマホからの操作を受けて、記録を読み書きするプログラム。Googleの設備(東京)で動く"),
        ("データベース", "記録をまとめて保管する専用の入れ物。決まりに合わないデータは受け付けない"),
        ("正本", "「これが正しい」とする元の記録。他の場所にあるのは写し"),
        ("写し(ミラー)", "正本の内容を別の場所(今のスプレッドシート)に一方向で書き写したもの"),
        ("Google Cloud(クラウド)", "自社でサーバーを持たず、Googleの設備を借りて使う形。使った分だけの費用"),
        ("PWA", "ホーム画面に追加すると、アプリのように使えるWebページ。アプリストアからの入手は不要"),
        ("プッシュ通知", "アプリを開いていなくても、スマホに届くお知らせ"),
        ("暗号化", "鍵が無いと読めない形にしてデータを保管すること"),
        ("専用の鍵(CMEK)", "暗号化の鍵をこのアプリ専用に用意し、使える人と鍵の交換を自分たちで管理する方式"),
    ],
    [
        ("役割(権限)", "スタッフ・コーディネーター・管理者で、見られる・直せる範囲を分けること"),
        ("操作ログ", "誰が・いつ・何をしたかの記録。後から確かめられる"),
        ("バックアップ", "万一に備えたデータの控え。一定の期間の、ある時点の状態に戻せる"),
        ("RESERVA(レセルバ)", "予約の管理に使っているシステム。お客様の情報の正本"),
        ("CSV", "表のデータを文字だけで書いたファイル。Excelでも開ける"),
        ("AI(Gemini)", "Googleの、文章を作ったり画像を読んだりするAI。日報の下書きと領収書の読み取りに使う"),
        ("PSI", "保護者のストレス度の5段階(5=安心・良好〜1=危険・緊急)。訪問ごとにスタッフが付ける"),
        ("教育思考★", "ご家庭の教育への関心の度合い(★1〜5)。お客様の情報の画面でスタッフが付ける"),
        ("GAS(Apps Script)", "今のアプリの作りに使っている、Googleのプログラムの仕組み"),
    ],
]
for part, terms in enumerate(glossary, start=1):
    s = new_slide(f"用語解説({part})", kicker="巻末")
    deck.page_of[f"glossary{part}"] = deck.page
    for i, (term, desc) in enumerate(terms):
        col, row = i % 2, i // 2
        if len(terms) % 2 == 1 and i == len(terms) - 1:
            col = 0
        x, y = 0.6 + col * 6.14, 1.45 + row * 1.08
        card(s, x, y, 5.99, 0.96)
        text(s, x + 0.2, y, 2.4, 0.96, term, size=15, color=DEEP, bold=True, anchor=MSO_ANCHOR.MIDDLE, line=1.05)
        text(s, x + 2.65, y, 3.2, 0.96, desc, size=13, anchor=MSO_ANCHOR.MIDDLE, line=1.1, space_after=0)
    notes(s, "資料の中で「※」を付けた言葉の説明です。")

# 20. まとめ
s = new_slide("まとめ", dark=True)
summary = [
    ("1", "スタッフの使い方は今のまま", "今の画面をもとに作り、予定・日報・領収書・出勤簿をスマホで扱う。お知らせと管理の画面が加わる"),
    ("2", "記録は1か所で、正確に", "正本はデータベースだけ。同時の保存・締めた月・領収書を仕組みで守り、計算は今のアプリと同じ"),
    ("3", "何重にも守る", "会社ごとの仕切り・役割ごとの制限・専用の鍵での暗号化・操作の記録・ログインの回数制限"),
]
for i, (n, head, body) in enumerate(summary):
    x = 0.6 + i * 4.1
    card(s, x, 1.55, 3.85, 4.4, fill=DARK_CARD)
    badge(s, x + 0.35, 1.85, 0.75, n, fill=MID, color=DEEP, size=26)
    text(s, x + 0.35, 2.8, 3.2, 1.1, head, size=23, color=WHITE, bold=True, line=1.1)
    text(s, x + 0.35, 3.95, 3.2, 1.95, body, size=17, color=PALE, line=1.25)
text(s, 0.6, 6.3, 12.1, 0.45, [[("お問い合わせ: ", {"bold": True}), ("ご不明な点は、開発担当までお気軽にご連絡ください。", {})]],
     size=16, color=WHITE)
notes(s, "要点は3つです。ご質問があればお知らせください。")

deck.save(OUT)
