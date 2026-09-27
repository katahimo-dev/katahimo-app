"""キューテスト様向け「新アプリ切替のご説明」スライドを作る。

使い方(doc/partner/README.md):
    # 画面の画像(架空のデータ)は、今のアプリ(GAS版)・新しいアプリとも手で撮って
    # doc/partner/.build/source/<場面>.gas.png・.web.png に置く
    python3 doc/partner/build_deck.py
    (PDF) soffice --headless --convert-to pdf --outdir doc/partner doc/partner/新アプリ切替のご説明_キューテスト様.pptx

画面の画像は doc/partner/.build/source/<場面>.gas.png / .web.png(架空のデータ)を上から切り出して使う。
切り出した画像は doc/partner/.build/(gitignore 済み)に置く。
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

from deck_lib import *  # noqa: F403(デザインの決まり・部品)

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
SHOTS = HERE / ".build" / "source"
BUILD = HERE / ".build"
OUT = HERE / "新アプリ切替のご説明_キューテスト様.pptx"

TOTAL = 23
FOOTER = "新しい訪問業務アプリへの切り替えについて|株式会社キューテスト様"

deck = Deck(TOTAL, FOOTER)
new_slide = deck.new_slide
page_ref = deck.page_ref


CROP_TOP = {"login": 260}  # ログインは画面の中ほどにあるため、上を少し切る


def crop_shot(name, variant, height=1200):
    src = SHOTS / f"{name}.{variant}.png"
    dst = BUILD / f"{name}.{variant}.png"
    if not src.exists():
        if dst.exists():
            return dst  # 撮り直していなければ、前に切り出した画像をそのまま使う
        raise SystemExit(f"画面の画像がありません: {src}\n先に doc/partner/.build/source/ に手で撮って置いてください(README.md)")
    BUILD.mkdir(exist_ok=True)
    im = Image.open(src)
    top = CROP_TOP.get(name, 0)
    im.crop((0, top, im.width, min(top + height, im.height))).save(dst)
    return dst


def screen_pair(slide, x, y, h, name, caption):
    """今のGAS版と新しいアプリの画面を左右に並べる。幅は h から決まる(780:1400)。"""
    w = h * 780 / 1200
    gap = 0.18
    for i, (variant, label) in enumerate((("gas", "今のアプリ"), ("web", "新しいアプリ"))):
        xi = x + i * (w + gap)
        text(slide, xi, y, w, 0.35, label, size=15, color=TEAL if i else MUTED, bold=True, align=PP_ALIGN.CENTER)
        frame = card(slide, xi - 0.04, y + 0.4, w + 0.08, h + 0.08, fill=LINE, radius=0.03)
        frame.shadow.inherit = False
        slide.shapes.add_picture(str(crop_shot(name, variant)), Inches(xi), Inches(y + 0.44), Inches(w), Inches(h))
    total_w = 2 * w + gap
    text(slide, x, y + h + 0.55, total_w, 0.4, caption, size=18, color=INK, bold=True, align=PP_ALIGN.CENTER)
    return total_w


# =============================================================================
# 1. 表紙
s = new_slide(dark=True)
badge(s, 0.9, 1.2, 0.9, "新", fill=TEAL, size=30)
text(s, 0.9, 2.4, 11.5, 1.8, ["新しい訪問業務アプリへの", "切り替えについて"], size=44, color=WHITE, bold=True,
     line=1.1, space_after=2)
text(s, 0.9, 4.45, 11, 0.6, "株式会社キューテスト様向け ご説明資料", size=24, color=RGBColor(0xCF, 0xEB, 0xE8))
text(s, 0.9, 5.2, 11, 0.5, "2026年9月", size=20, color=RGBColor(0xB5, 0xD8, 0xD6))
text(s, 0.9, 6.35, 11.5, 0.5, "いまお使いの「保育日報」アプリ(Googleスプレッドシート版)からの切り替えのご案内です",
     size=16, color=RGBColor(0xB5, 0xD8, 0xD6))
notes(s, "本日は、スタッフの皆さまが毎日お使いの「保育日報」アプリを、新しい仕組みに切り替えるご相談です。"
         "専門用語はできるだけ使わずにご説明します。")

# 2. 要点3つ
s = new_slide("このご説明の目的と要点", kicker="はじめに")
text(s, 0.6, 1.45, 12, 0.5, "新しいアプリへの切り替えを、安心してご判断いただくための資料です。", size=20, color=MUTED)
points = [
    ("1", "スタッフの使い方は\nほぼそのまま", "今の画面をもとに作っているので、使い方はほぼそのまま。ログインも今のパスワードで。"),
    ("2", "記録がより安全・\n正確になります", "データを保管場所ごと暗号化、会社ごとのデータの分離、操作の記録、同時に直したときの保護。"),
    ("3", "切り替えは段階的に、\n戻せる形で", "準備 → 試しに使う → 切替日 → 確認 の順に進め、万一のときの戻し方も用意します。"),
]
for i, (n, head, body) in enumerate(points):
    x = 0.6 + i * 4.1
    card(s, x, 2.25, 3.85, 4.35)
    badge(s, x + 0.35, 2.55, 0.75, n, size=26)
    text(s, x + 0.35, 3.5, 3.2, 1.2, head, size=24, color=DEEP, bold=True, line=1.1)
    text(s, x + 0.35, 4.75, 3.2, 1.8, body, size=18, line=1.25)
notes(s, "要点は3つです。①スタッフの使い方はほぼ変わらない。②記録の安全性と正確さが上がる。③切り替えは段階的に進め、戻し方も用意する。")

# 3. いまの仕組みの課題
s = new_slide("いまの仕組み(スプレッドシート+Apps Script)の課題", kicker="いまの状況")
issues = [
    ("遅", "待ち時間が出やすい", "開くたび・保存のたびに、スプレッドシートを読み書きしています"),
    ("重", "同時の保存に弱い", "同時に保存すると順番待ちになり、後の保存で上書きされることも"),
    ("6", "処理は6分まで", "Googleの決まりで、夜のまとめ処理も6分以内に収める必要があります"),
    ("散", "データが散らばる", "お客様・スタッフ・出勤簿・日報が、たくさんのシートとフォルダに分かれています"),
    ("鍵", "権限を分けにくい", "シートの共有設定が頼りで、人ごとに細かく分けにくい"),
    ("＋", "機能を足しにくい", "1社専用のつくりで、割り振りや他社への展開は作り直しが必要"),
]
for i, (ic, head, body) in enumerate(issues):
    col, row = i % 3, i // 3
    x, y = 0.6 + col * 4.1, 1.55 + row * 2.45
    card(s, x, y, 3.85, 2.2)
    badge(s, x + 0.3, y + 0.3, 0.62, ic, size=20)
    text(s, x + 1.1, y + 0.3, 2.6, 0.62, head, size=21, color=DEEP, bold=True, anchor=MSO_ANCHOR.MIDDLE)
    text(s, x + 0.3, y + 1.08, 3.3, 1.05, body, size=17, line=1.2)
text(s, 0.6, 6.5, 12.1, 0.4, "※ 今のアプリは毎日きちんと動いています。上は「これから先」を考えたときの課題です。", size=15, color=MUTED)
notes(s, "今のアプリはGoogleスプレッドシートとApps Scriptで作られています。小さく始めるには最適でしたが、"
         "記録が増え、使う人が増えるにつれて、ここに挙げたような限界が見えてきました。6分の上限はGoogle Apps Scriptの仕様です。")

# 4. 新しいアプリとは
s = new_slide("新しいアプリとは", kicker="ひとことで")
card(s, 0.6, 1.45, 12.13, 0.95, fill=TINT2)
text(s, 0.9, 1.45, 11.6, 0.95, "今の画面をもとに、中身を「会社の業務システム」として作り直したものです",
     size=22, color=DEEP, bold=True, anchor=MSO_ANCHOR.MIDDLE)
# 図: スマホ → 新アプリ → データベース
boxes = [
    (0.6, "スマホ・パソコン", "スタッフ・事務局の皆さま"),
    (4.87, "新しいアプリ", "Google Cloud(東京)で動きます"),
    (9.14, "データベース", "記録の正本をまとめて保管"),
]
for x, head, sub in boxes:
    card(s, x, 2.85, 3.6, 1.6, fill=DEEP if head == "新しいアプリ" else TINT,
         line=None)
    c = WHITE if head == "新しいアプリ" else DEEP
    text(s, x, 2.95, 3.6, 0.7, head, size=24, color=c, bold=True, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    text(s, x, 3.65, 3.6, 0.6, sub, size=16, color=WHITE if head == "新しいアプリ" else MUTED,
         align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
arrow(s, 4.3, 3.65, 4.77, 3.65, width=4)
arrow(s, 8.57, 3.65, 9.04, 3.65, width=4)
# 連携先
links = [
    ("Googleカレンダー", "予定を今までどおり読む"),
    ("Googleドライブ", "顧客CSVを毎晩取り込む"),
    ("スプレッドシート", "必要な間だけ書き写す"),
    ("地図・AI・チャット", "道順・日報の下書き・通知"),
]
text(s, 0.6, 4.75, 12, 0.4, "今お使いのGoogleのサービスとも、これまでどおりつながります", size=17, color=MUTED,
     align=PP_ALIGN.CENTER)
for i, (head, sub) in enumerate(links):
    x = 0.6 + i * 3.07
    card(s, x, 5.25, 2.85, 1.45, fill=WHITE, line=MID)
    text(s, x, 5.35, 2.85, 0.55, head, size=18, color=DEEP, bold=True, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    text(s, x, 5.9, 2.85, 0.65, sub, size=15, color=INK, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
notes(s, "スタッフはスマホで新しいアプリを開きます。アプリはGoogle Cloudの東京のデータセンターで動き、記録はデータベースにまとめて保管します。"
         "予定はこれまでどおりGoogleカレンダーから読み、お客様のCSVはGoogleドライブから毎晩取り込みます。"
         "スプレッドシートへの書き写しは、必要な間だけ続けることができます(続けるかどうかは選べます)。")

# 5〜7. 画面
s = new_slide("スタッフの使い方はほぼそのまま(1)", kicker="画面")
text(s, 0.6, 1.3, 12, 0.45, "左が今のアプリ、右が新しいアプリです(どちらも架空の人物・住所)。",
     size=17, color=MUTED)
screen_pair(s, 0.9, 1.75, 4.1, "login", "ログイン")
screen_pair(s, 7.1, 1.75, 4.1, "schedule-today", "今日の予定と道順")
notes(s, "ログイン画面と、今日の予定・道順の画面です。新しいアプリは今の画面をもとに作っているので、使い方はほぼそのままです。"
         "スマホへの通知や管理者の方の画面など、新しく加わるものは、この後のページでご説明します。")

s = new_slide("スタッフの使い方はほぼそのまま(2)", kicker="画面")
text(s, 0.6, 1.3, 12, 0.45, "お客様の情報や、AIが下書きする日報も、今の流れのまま使えます。", size=17, color=MUTED)
screen_pair(s, 0.9, 1.75, 4.1, "customer-detail", "お客様の情報")
screen_pair(s, 7.1, 1.75, 4.1, "report-daily-result", "日報(AIの下書き)")
notes(s, "お客様の情報の画面と、日報をAIに下書きしてもらった後の画面です。")

s = new_slide("スタッフの使い方はほぼそのまま(3)", kicker="画面")
text(s, 0.6, 1.3, 12, 0.45, "出勤簿も、週の一覧・1日の表示・修正の流れを引き継いでいます。", size=17, color=MUTED)
screen_pair(s, 0.9, 1.75, 4.1, "att-week-list", "出勤簿(週の一覧)")
card(s, 7.1, 2.2, 5.63, 4.55)
badge(s, 7.45, 2.5, 0.75, "✓", size=26)
text(s, 8.4, 2.5, 4.1, 0.75, "画面の引き継ぎ方", size=24, color=DEEP, bold=True, anchor=MSO_ANCHOR.MIDDLE)
bullets(s, 7.45, 3.5, 5.0, 3.2, [
    "今のアプリの画面をもとに、言葉・ボタンの並び・色を引き継いで作りました",
    "出勤簿や道順の計算は、今のアプリのプログラムと結果を突き合わせて確かめています",
    "これからの使いやすさの改善は、新しいアプリで行います",
], size=18)
notes(s, "画面は今のアプリをもとに作り、言葉やボタンの並びを引き継いでいます。今のアプリで使い慣れた流れのまま使えます。"
         "出勤簿や道順の計算は、今のアプリのプログラムそのものと結果を突き合わせて確かめています。"
         "今後の画面の改善は、新しいアプリの側で行っていきます。")

# 8. 新しく加わること① スマホへの通知
s = new_slide("新しく加わること① 明日の予定をスマホにお知らせ", kicker="何が加わるか")
text(s, 0.6, 1.4, 12.1, 0.5, "今のLINE WORKSのお知らせに代わり、毎日19時に、明日の予定をアプリからスマホへお知らせします。",
     size=18, color=MUTED)
# 通知の見本(架空の予定)
card(s, 0.6, 2.1, 5.3, 3.35, fill=TINT2)
text(s, 0.85, 2.25, 4.8, 0.4, "スマホに届くお知らせ(見本)", size=15, color=MUTED, bold=True)
card(s, 0.85, 2.75, 4.8, 2.05, fill=WHITE, line=LINE)
text(s, 1.1, 2.88, 4.3, 0.45, "明日の予定 9/27(日) 3件", size=19, color=DEEP, bold=True)
text(s, 1.1, 3.4, 4.3, 1.3, ["9:30〜11:30 田中 さくら様", "13:00〜15:00 山田 花子様", "16:00〜18:00 佐藤 ひなた様"],
     size=16, space_after=3)
text(s, 0.85, 4.88, 4.8, 0.5, "押すと、アプリで明日の予定と道順が開きます", size=15, color=TEAL, bold=True)
# はじめに一度だけ
text(s, 6.3, 2.1, 6.4, 0.5, "スタッフの皆さまに、はじめに一度だけ", size=20, color=DEEP, bold=True)
steps = [
    ("1", "アプリの「設定」を開き、「翌日の予定を通知する」をオンにする"),
    ("2", "スマホに「通知を許可しますか」と出たら「許可」を押す"),
    ("3", "「テスト通知を送る」を押して、届くことを確かめる"),
]
for i, (n, body) in enumerate(steps):
    y = 2.7 + i * 0.92
    badge(s, 6.35, y + 0.08, 0.6, n, size=20)
    text(s, 7.15, y, 5.55, 0.78, body, size=17, anchor=MSO_ANCHOR.MIDDLE, line=1.15)
card(s, 0.6, 5.65, 12.13, 1.1, fill=TINT)
text(s, 0.9, 5.65, 11.6, 1.1, [
    "iPhone・iPadは、Safariの共有ボタンから「ホーム画面に追加」したアプリを開いてからオンにします。",
    "お知らせには住所や電話番号は出しません。スマホや機種を変えたときは、その端末でもう一度オンにします。",
], size=15, anchor=MSO_ANCHOR.MIDDLE, space_after=4, line=1.15)
notes(s, "今は古い仕組み(ルート検索の夜間処理)が、毎晩LINE WORKSで明日の予定を送っています。"
         "新しいアプリでは、アプリそのものがスマホに通知を送ります。スタッフの皆さまには、はじめに一度だけ、設定で通知をオンにしていただきます。"
         "iPhoneはホーム画面に追加したアプリからでないと通知を受け取れません(iOS 16.4以降)。"
         "通知には時刻とお名前だけを出し、住所・電話番号・道順は押した先のアプリで見ます。ロック画面に個人情報を出さないためです。"
         "LINE WORKSのお知らせは、全員がオンにしたことを確かめてから止めます。"
         "今のLINE WORKSのお知らせの末尾にある「訪問時お願い」(生年月日の登録を促す一文)は、新しい通知には入りません。")

# 9. 新しく加わること② 管理者の画面
s = new_slide("新しく加わること② 管理者の方の画面", kicker="何が加わるか")
card(s, 0.6, 1.45, 12.13, 0.95, fill=TINT2)
text(s, 0.9, 1.45, 11.6, 0.95, "今シートを直接直している管理の作業は、アプリの「管理」の画面で行います(管理者の方だけ)",
     size=19, color=DEEP, bold=True, anchor=MSO_ANCHOR.MIDDLE)
adm = [
    ("人", "スタッフの管理", [
        "登録・変更・退職日の設定",
        "自宅住所・予定のカレンダーもここで",
        "初めてのパスワードは案内メールで(管理者はパスワードを知りません)",
    ]),
    ("AI", "AIへの指示", [
        "日報・事故報告の下書きの指示と、入力欄の例を直せる",
        "いつでも最初の文に戻せる",
        "2人が同時に直しても、知らないうちに上書きしない",
    ]),
    ("記", "操作の記録", [
        "誰がいつ何をしたかを、期間・スタッフで絞って見る",
        "CSVで保存できる",
        "記録を見たこと自体も残ります",
    ]),
]
for i, (ic, head, items) in enumerate(adm):
    x = 0.6 + i * 4.1
    card(s, x, 2.65, 3.85, 3.55)
    badge(s, x + 0.3, 2.9, 0.75, ic, size=22 if len(ic) == 1 else 18)
    text(s, x + 1.25, 2.9, 2.5, 0.75, head, size=21, color=DEEP, bold=True, anchor=MSO_ANCHOR.MIDDLE)
    bullets(s, x + 0.3, 3.85, 3.35, 2.3, items, size=16, gap=8)
text(s, 0.6, 6.4, 12.1, 0.4, "※ シートは見るだけの写しになります(シートで直してもアプリには入りません)。お客様の情報は今までどおり顧客CSVで更新します。",
     size=14, color=MUTED)
notes(s, "これまで管理者の方がスタッフ台帳やAIの指示のシートを直接直していた作業は、アプリの管理の画面に移ります。"
         "入力の確認や、2人が同時に直したときの保護、操作の記録がつくので、誤って壊してしまう心配が減ります。"
         "スタッフを消すことは、記録が1件も無い(間違えて登録した)場合だけできます。辞めた方は退職日を入れます。"
         "お客様の情報をアプリで直す機能は、今後の予定です。今までどおり顧客CSVの取り込みで更新されます。")

# 10. 速さ・安定性
s = new_slide("良くなること① 速さと安定性", kicker="何が良くなるか")
rows = [
    ("速", "待ち時間を短く", "記録はデータベースから直接読むので、スプレッドシートを開く待ち時間がなくなります(本番での体感は切替前に確認します)"),
    ("増", "混んでも落ち着いて", "使う人が多い時間は、自動でサーバーの台数を増やして対応します"),
    ("6", "6分の上限がなくなる", "夜のまとめ処理はGoogle Apps Scriptの6分の決まりに縛られません。スタッフが増えても安心です"),
    ("見", "見張りとお知らせ", "外から定期的に動作を確かめ、異常があれば担当者にメールで知らせる仕組みを用意しています"),
]
for i, (ic, head, body) in enumerate(rows):
    y = 1.4 + i * 1.2
    badge(s, 0.7, y + 0.12, 0.8, ic, size=24)
    text(s, 1.75, y, 3.3, 1.05, head, size=22, color=DEEP, bold=True, anchor=MSO_ANCHOR.MIDDLE)
    text(s, 5.0, y, 7.7, 1.05, body, size=18, anchor=MSO_ANCHOR.MIDDLE, line=1.2)
text(s, 0.6, 6.35, 12.1, 0.4, "例)朝、出勤前に「今日の予定」を開くとき/夕方に日報をまとめて保存するとき", size=16, color=TEAL, bold=True)
notes(s, "速さについては、スプレッドシートを毎回読み書きしなくなるぶん待ち時間は短くなる見込みですが、"
         "実際の体感は本番環境を作ったあと、切替前に確かめます。")

# 11. データの安全
s = new_slide("良くなること② データの安全", kicker="何が良くなるか")
safe = [
    ("鍵", "データは保管場所ごと、このアプリ専用の鍵で暗号化",
     "データベースとそのバックアップ、領収書の画像を丸ごと暗号化します(Google Cloudの保存データの暗号化。"
     "鍵はGoogle Cloudの鍵管理サービスで厳重に管理)。医療機関向けの国のガイドライン(3省2ガイドライン)でも一般的な保護の水準です"),
    ("分", "会社ごとにデータを分離", "仕組みの一番下で会社ごとに区切るので、他の会社のデータは見えず、触れません"),
    ("人", "できることを役割で分ける", "スタッフが見て直せるのは自分の予定・出勤簿だけ。他の人の日報は上書きできません。管理の画面は管理者だけ"),
    ("記", "開いた人・変えた内容を記録", "お客様の情報を誰がいつ開いたか、誰が何を変えたかを残します。日報を書き直しても、前の内容が履歴に残ります"),
    ("P", "ログインの回数を制限", "続けて間違えると一時的にロックします。パスワードも安全な方式で保存します"),
]
for i, (ic, head, body) in enumerate(safe):
    # 1枚目(暗号化)は横いっぱい、残りの4枚は2列。どれも説明が3行まで入る高さ
    if i == 0:
        x, y, w, h = 0.6, 1.5, 12.08, 1.68
    else:
        col, row = (i - 1) % 2, (i - 1) // 2
        x, y, w, h = 0.6 + col * 6.13, 3.33 + row * 1.74, 5.95, 1.66
    card(s, x, y, w, h)
    badge(s, x + 0.25, y + (h - 0.8) / 2, 0.8, ic, size=24)
    text(s, x + 1.25, y + 0.12, w - 1.45, 0.5, head, size=20, color=DEEP, bold=True)
    text(s, x + 1.25, y + 0.62, w - 1.45, h - 0.7, body, size=16, line=1.2)
notes(s, "お預かりするデータは、保管場所ごと、つまりデータベースとそのバックアップ、領収書の画像を丸ごと、このアプリ専用の鍵で暗号化します。"
         "Google Cloud の保存データの暗号化の仕組みで、鍵は Google Cloud の鍵管理サービスで厳重に管理します。"
         "医療機関向けの国のガイドライン(3省2ガイドライン)でも一般的な保護の水準ですので、ご安心ください。"
         "ガイドラインの認証を受けたという意味ではありません。"
         "加えて、会社ごとのデータの分離、役割ごとにできることの制限、お客様の情報を誰がいつ開いたかの記録、ログインの回数の制限で守ります。"
         "パスワードの再設定は今と同じく、メールで届く6桁の番号(30分有効)で行います。")

# 12. 正確さ
s = new_slide("良くなること③ 記録の正確さ", kicker="何が良くなるか")
acc = [
    ("同時に直しても安心", "2人が同じ記録を同時に直すと、後の人に「読み込み直してからもう一度」とお知らせ。知らないうちの上書きを防ぎます"),
    ("月の締めを守る", "出勤簿を直せるのは今月分だけ(今と同じ)。締めた月は、データベースが変更を受け付けません"),
    ("二重登録を防ぐ", "同じ領収書を二度送っても一度だけ登録(今と同じ判定)。夜の処理はやり直しても二重になりません"),
    ("取り込みミスで止まる", "お客様CSVで2割を超えるお客様が消えるような内容なら、取り込まずに止めて確認を待ちます"),
    ("計算結果は今と同じ", "出勤簿や道順の計算は、今のアプリのプログラムそのものと結果を突き合わせて確かめています"),
]
for i, (head, body) in enumerate(acc):
    y = 1.45 + i * 1.07
    card(s, 0.6, y, 12.13, 0.92, fill=TINT if i % 2 == 0 else WHITE, line=None if i % 2 == 0 else LINE)
    badge(s, 0.8, y + 0.16, 0.6, "✓", size=20)
    text(s, 1.6, y, 3.4, 0.92, head, size=20, color=DEEP, bold=True, anchor=MSO_ANCHOR.MIDDLE)
    text(s, 5.0, y, 7.55, 0.92, body, size=16, anchor=MSO_ANCHOR.MIDDLE, line=1.15)
notes(s, "例えば、事務局の方とスタッフが同じ日の出勤簿を同時に直した場合、今は後から保存した方の内容が残りますが、"
         "新しいアプリでは後の方に「読み込み直してから」とお知らせします。")

# 13. 自動化
s = new_slide("良くなること④ 夜の自動処理", kicker="何が良くなるか")
text(s, 0.6, 1.4, 12.1, 0.5, "今と同じ時刻の処理に、明日の予定のお知らせが加わります。失敗したら自動でやり直し、それでもだめならお知らせします。",
     size=17, color=MUTED)
# 時間の流れ
tl_y = 3.1
conn = s.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(1.2), Inches(tl_y), Inches(12.1), Inches(tl_y))
conn.line.color.rgb = MID
conn.line.width = Pt(3)
steps = [
    ("19:00", "明日の予定", "通知をオンにしたスタッフのスマホへお知らせ"),
    ("22:00", "出勤簿に反映", "カレンダーの今日の予定を、全スタッフの出勤簿へ"),
    ("3:00", "お客様を最新に", "Googleドライブの最新の顧客CSVを取り込み"),
    ("4:00", "お片付け", "古くなった記録や使われない画像を整理"),
    ("朝", "結果の確認", "失敗があれば担当者にメールでお知らせ"),
]
for i, (t, head, body) in enumerate(steps):
    cx = 1.75 + i * 2.45
    badge(s, cx - 0.6, tl_y - 0.6, 1.2, t, size=19 if len(t) > 2 else 24)
    card(s, cx - 1.13, 4.0, 2.26, 2.3)
    text(s, cx - 1.05, 4.15, 2.1, 0.55, head, size=19, color=DEEP, bold=True, align=PP_ALIGN.CENTER)
    text(s, cx - 0.98, 4.75, 1.96, 1.5, body, size=16, align=PP_ALIGN.LEFT, line=1.2)
notes(s, "毎晩22時に今日の予定を出勤簿へ反映、3時に顧客CSVの取り込みという流れは今のアプリと同じ時刻です。"
         "19時の明日の予定のお知らせは、今LINE WORKSで届いているお知らせの代わりです。"
         "4時の整理は新しいアプリで加わった保守の処理です。お客様のデータの変化が大きすぎるときは、取り込まずに止めます。")

# 14. 将来
s = new_slide("良くなること⑤ これから先の広がり", kicker="何が良くなるか")
fut = [
    ("割", "スタッフの最適な割り振り", [
        "事務局向けに、お客様とスタッフの組み合わせを考えるアプリを作れます",
        "得意なこと・勤務できる時間・予定の空き・相性を入れる箱は、もう用意してあります",
    ]),
    ("広", "他の事業者さまへの展開", [
        "1つの仕組みで、複数の会社のデータを安全に分けて扱えます",
        "キューテスト様で育てた使い方を、ほかの事業者さまにも広げられます",
    ]),
]
for i, (ic, head, items) in enumerate(fut):
    x = 0.6 + i * 6.13
    card(s, x, 1.5, 5.95, 3.9)
    badge(s, x + 0.35, 1.8, 0.9, ic, size=28)
    text(s, x + 1.45, 1.8, 4.3, 0.9, head, size=23, color=DEEP, bold=True, anchor=MSO_ANCHOR.MIDDLE)
    bullets(s, x + 0.4, 3.0, 5.2, 3.0, items, size=18, gap=12)
text(s, 0.6, 5.75, 12.1, 0.4, "※ どちらも「これから作るもの」です。今回の切り替えでは、今のアプリの機能に、通知と管理の画面を加えてお届けします。", size=15, color=MUTED)
notes(s, "割り振りのアプリはまだ作っていません。データを入れる箱(設計)を先に用意してあるので、今回の切り替えのあとに作り始められます。")

# 15. 変わること・変わらないこと
s = new_slide("変わること・変わらないこと", kicker="まとめ")
same = [
    "画面の使い方(今の画面をもとに作っています)",
    "ログインのメールアドレスとパスワード",
    "予定はGoogleカレンダーで管理",
    "毎晩の出勤簿への反映・顧客CSVの取り込み",
    "日報のAI下書き・領収書の読み取り・チャットへの通知",
]
diff = [
    "アプリのURL(ホーム画面に追加し直します)",
    "記録の正本はデータベースに。シートは見るだけの写し",
    "明日の予定はLINE WORKSではなく、スマホの通知で",
    "スタッフ・AIの指示の管理は、アプリの管理の画面で",
    "シートへの書き写しは必要な間だけ(選べます)",
    f"毎月のクラウド利用料がかかります({page_ref('cost')}ページ)",
]
for i, (head, items, fill, hc) in enumerate((("変わらないこと", same, TINT, DEEP), ("変わること", diff, WHITE, TEAL))):
    x = 0.6 + i * 6.13
    card(s, x, 1.5, 5.95, 5.25, fill=fill, line=None if i == 0 else MID)
    badge(s, x + 0.3, 1.72, 0.7, "＝" if i == 0 else "→", size=22, fill=DEEP if i == 0 else TEAL)
    text(s, x + 1.2, 1.72, 4.5, 0.7, head, size=24, color=hc, bold=True, anchor=MSO_ANCHOR.MIDDLE)
    bullets(s, x + 0.35, 2.7, 5.4, 4.0, items, size=17, gap=9)
notes(s, "LINE WORKSで明日の予定を送っている古い仕組み(ルート検索の夜間処理)は、新しいアプリのスマホへの通知に置き換わります。"
         "スタッフ全員が通知をオンにしたことを確かめてから、古い仕組みを止めます。"
         "スタッフ台帳やAIの指示は、スプレッドシートではなくアプリの管理の画面で直します。スプレッドシートは見るだけの写しになります。")

# 16. 引っ越しの流れ
s = new_slide("データの引っ越し(移行)の流れ", kicker="進め方")
phases = [
    ("1", "準備", ["本番の環境をつくる", "台帳・お客様・今月の出勤簿を取り込む", "今のパスワードでログインできるか確認"]),
    ("2", "試しに使う", ["事務局と一部のスタッフで試用", "同じ日を両方のアプリで入力しない"]),
    ("3", "切替日", ["今のアプリの夜間処理を止め、新しい夜間処理を始める", "スタッフに新しいURLをご案内", "各自がスマホの通知をオンに"]),
    ("4", "切替後の確認", ["翌朝、出勤簿とお客様データの更新を確認", "全員が通知をオンにしたら、LINE WORKSのお知らせを止める", "残っている古い仕組みを順に止める"]),
]
pw = 2.8
for i, (n, head, items) in enumerate(phases):
    x = 0.6 + i * (pw + 0.24)
    chev = shape(s, MSO_SHAPE.CHEVRON if i else MSO_SHAPE.PENTAGON, x, 1.55, pw + 0.12, 0.95,
                 fill=[TINT2, MID, TEAL, DEEP][i])
    chev.adjustments[0] = 0.3
    tcol = DEEP if i < 2 else WHITE
    text(s, x + (0.35 if i else 0.2), 1.55, pw - 0.4, 0.95, [[(n + " ", {"size": 22}), (head, {})]], size=22,
         color=tcol, bold=True, anchor=MSO_ANCHOR.MIDDLE)
    card(s, x, 2.8, pw, 3.65, fill=TINT if i != 2 else TINT2)
    bullets(s, x + 0.2, 3.0, pw - 0.35, 3.4, items, size=17, gap=10)
text(s, 0.6, 6.55, 12.1, 0.4, "日程は、キューテスト様のご都合を伺って決めます。試用の期間は必要に応じて調整できます。", size=15, color=MUTED)
notes(s, "準備では、スタッフ台帳・顧客CSV・各スタッフの今月分の出勤簿を新しいアプリに取り込みます。"
         "試用期間中に両方のアプリで同じ日を入力すると、どちらかの入力が残らないことがあるため、同じ日は片方だけで入力します。")

# 17. 切替日のチェックリスト
s = new_slide("切替日のチェックリスト", kicker="進め方")
checks = [
    ("今のアプリの夜の処理(22時の出勤簿反映・3時のお客様取り込み)を止める", "開発担当"),
    ("新しいアプリの夜の処理を始める(同じ日に行い、二重の反映を防ぎます)", "開発担当"),
    ("スタッフ全員に新しいURLをお知らせし、ホーム画面に追加してもらう", "ご担当者"),
    ("スタッフ各自が設定で「翌日の予定を通知する」をオンにし、テスト通知で確かめる", "各スタッフ"),
    ("ログイン・今日の予定・日報の保存を、事務局と数名のスタッフで確かめる", "ご一緒に"),
    ("翌朝、出勤簿とお客様データが夜のうちに更新されたことを確かめる", "開発担当"),
]
for i, (t, who) in enumerate(checks):
    y = 1.45 + i * 0.89
    card(s, 0.6, y, 12.13, 0.77, fill=TINT if i % 2 == 0 else WHITE, line=None if i % 2 == 0 else LINE)
    box = shape(s, MSO_SHAPE.ROUNDED_RECTANGLE, 0.85, y + 0.16, 0.44, 0.44, fill=WHITE, line=TEAL, radius=0.15)
    text(s, 1.55, y, 8.9, 0.77, t, size=17, anchor=MSO_ANCHOR.MIDDLE, line=1.15)
    tag = card(s, 10.7, y + 0.14, 1.8, 0.5, fill=DEEP if who == "開発担当" else TEAL, radius=0.5)
    text(s, 10.7, y + 0.14, 1.8, 0.5, who, size=15, color=WHITE, bold=True, align=PP_ALIGN.CENTER,
         anchor=MSO_ANCHOR.MIDDLE)
notes(s, "今のアプリと新しいアプリの夜の処理を同じ日に切り替えるのは、同じ予定が二重に出勤簿へ反映されたり、顧客CSVが二重に取り込まれたりしないためです。"
         "通知は端末ごとの設定なので、スタッフお一人おひとりにオンにしていただきます。全員がオンにするまでは、LINE WORKSのお知らせも届き続けます。")

# 18. 万一のとき
s = new_slide("万一のときの戻し方と安心材料", kicker="安心のために")
rb = [
    ("戻", "アプリの不具合", "新しい版に問題があれば、ひとつ前の版にすぐ戻せます"),
    ("保", "データのバックアップ", "毎日自動で保存(14日分)。さらに過去7日の好きな時点に戻せます"),
    ("残", "今のアプリはすぐには消しません", "慣れるまで残し、止めた夜の処理も元に戻せます。戻す手順は切替前に一緒に確かめます"),
    ("写", "シートへの書き写し(選べます)", "続ければ、切替後の記録もスプレッドシートで見られます(見るだけの写し。今のアプリ側の準備が必要です)"),
]
for i, (ic, head, body) in enumerate(rb):
    col, row = i % 2, i // 2
    x, y = 0.6 + col * 6.13, 1.5 + row * 2.05
    card(s, x, y, 5.95, 1.85)
    badge(s, x + 0.3, y + 0.3, 0.8, ic, size=24)
    text(s, x + 1.3, y + 0.25, 4.5, 0.6, head, size=20, color=DEEP, bold=True, anchor=MSO_ANCHOR.MIDDLE)
    text(s, x + 1.3, y + 0.85, 4.5, 0.95, body, size=16, line=1.2)
card(s, 0.6, 5.7, 12.13, 1.05, fill=DEEP)
text(s, 0.9, 5.7, 11.6, 1.05, "計算は今のアプリのプログラムと突き合わせ、ログインから日報・出勤簿までの操作は自動で通して確かめています",
     size=18, color=WHITE, bold=True, anchor=MSO_ANCHOR.MIDDLE, line=1.15)
notes(s, "今のアプリ(Googleスプレッドシート版)の画面は、誰も使わなくなるまで公開したままにします。"
         "スプレッドシートへの書き写しを続ける場合は、今のアプリ側に書き写しの受け口を設置する作業が切替前に必要です。")

# 19. お願い
s = new_slide("キューテスト様にお願いしたいこと", kicker="ご協力のお願い")
asks = [
    ("1", "ご担当者を決める", "事務局ご担当者(切替日の連絡窓口・スタッフへのご案内役)"),
    ("2", "スタッフ台帳の確認", "在籍・退職日・メールアドレス・管理者の方が正しいか"),
    ("3", "お客様CSVとカレンダーの共有", "新しいアプリが読めるよう、共有の設定にご協力ください"),
    ("4", "シートの写しを続ける期間", "切替後もスプレッドシートで見たいもの(日報・領収書・出勤簿)と、続ける期間"),
    ("5", "切替日の調整とスタッフへの周知", "新しいURL・ホーム画面への追加・スマホの通知のオンのしかた"),
]
for i, (n, head, body) in enumerate(asks):
    y = 1.5 + i * 1.03
    badge(s, 0.7, y + 0.12, 0.66, n, size=22)
    text(s, 1.6, y, 4.6, 0.9, head, size=21, color=DEEP, bold=True, anchor=MSO_ANCHOR.MIDDLE)
    text(s, 6.2, y, 6.5, 0.9, body, size=17, anchor=MSO_ANCHOR.MIDDLE, line=1.15)
    if i < 4:
        ln = s.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(1.6), Inches(y + 0.98), Inches(12.7), Inches(y + 0.98))
        ln.line.color.rgb = LINE
        ln.line.width = Pt(1)
notes(s, "カレンダーと顧客CSVのフォルダは、新しいアプリ専用のGoogleのアカウント(サービス用のアドレス)に「閲覧」で共有していただく必要があります。"
         "共有先のアドレスは本番の環境を作った時点でお伝えします。パスワード再設定メールの送信元(Google Workspaceのメール送信の設定)もご相談します。")

# 20. 費用
s = new_slide("費用の目安(毎月のクラウド利用料)", kicker="費用")
deck.page_of["cost"] = deck.page
card(s, 0.6, 1.5, 5.0, 4.6, fill=DEEP)
text(s, 0.9, 1.75, 4.4, 0.5, "月額の目安", size=20, color=RGBColor(0xCF, 0xEB, 0xE8), bold=True)
text(s, 0.9, 2.35, 4.4, 1.2, [[("約", {"size": 24}), ("2,100〜4,700", {"size": 32}), ("円", {"size": 24})]], size=38, color=WHITE, bold=True)
text(s, 0.9, 3.55, 4.4, 0.5, "(約14〜31ドル)", size=20, color=WHITE)
text(s, 0.9, 4.3, 4.4, 1.7, ["1ドル=150円で換算した概算です。", "AIの利用料(見込み)を含みます。"],
     size=16, color=RGBColor(0xCF, 0xEB, 0xE8), line=1.25)
cost_rows = [
    ("データベース", "12〜14ドル"),
    ("書き写し・メール・通知の送信", "0〜3ドル"),
    ("アプリ本体・夜の処理・保管など", "0〜7ドル"),
    ("地図(道順)", "無料枠内の見込み"),
    ("AI(日報の下書き・領収書の読み取り)", "2〜8ドル"),
]
for i, (k, v) in enumerate(cost_rows):
    y = 1.5 + i * 0.8
    card(s, 5.9, y, 6.83, 0.68, fill=TINT if i % 2 == 0 else WHITE, line=None if i % 2 == 0 else LINE)
    text(s, 6.1, y, 4.2, 0.68, k, size=16, anchor=MSO_ANCHOR.MIDDLE)
    text(s, 10.2, y, 2.4, 0.68, v, size=16, color=DEEP, bold=True, anchor=MSO_ANCHOR.MIDDLE, align=PP_ALIGN.RIGHT)
text(s, 5.9, 5.55, 6.83, 0.6, "使いすぎを防ぐため、月1万円の予算に近づくとメールで知らせる設定も用意しています。", size=15,
     color=MUTED, line=1.2)
text(s, 0.6, 6.35, 12.1, 0.5, "※ 2026年9月27日時点の料金表からの見込み(目安)です。料金は変わることがあるため、本番の環境を作る前に確かめ直します。",
     size=14, color=MUTED)
notes(s, "内訳は東京リージョンの概算で、スタッフ10人・1人1日1〜2件の報告を前提にしています。いちばん大きいのはデータベースで、"
         "今の規模に合わせた小さな構成(約12〜14ドル)です。利用が増えたら数分の再起動だけで大きくできます(データはそのまま)。"
         "スプレッドシートへの書き写し・パスワード再設定メール・スマホへの通知は、送るものができたときと10分ごとの見回りのときだけ短い時間動く処理で送るため、"
         "常に動かしておく費用がかからず、月0〜3ドルほど(無料枠の範囲に収まる見込み)です。操作からおよそ10〜30秒で届きます。"
         "地図は、スタッフ10人が1日3件訪問する程度なら毎月の無料枠内に収まる見込みです。AIは日報の下書きが大半で、月2〜8ドルほどの見込みです。"
         "今のアプリ(Apps Script)にはサーバーの固定費がありませんが、新しいアプリでは上のクラウド利用料が毎月かかります。")

# 21〜22. よくあるご質問
faq1 = [
    ("スタッフのログインは変わりますか?",
     "今と同じメールアドレスとパスワードでログインします。変わるのはアプリのURLだけで、スマホのホーム画面に追加し直していただきます。"),
    ("今のパスワードはそのまま使えますか?",
     "はい。今のパスワードを引き継ぎ、最初のログインのときに自動で、より安全な保存方式に置き換わります(切替前に実際に確かめます)。"),
    ("Googleカレンダーの使い方は変わりますか?",
     "変わりません。予定はこれまでどおりカレンダーへ。新しいアプリがそれを読んで表示します。"),
    ("明日の予定のお知らせはどう届きますか?",
     "毎日19時にスマホへ通知が届きます(各自が設定で一度オンに。iPhoneはホーム画面に追加してから)。押すと明日の予定と道順が開きます。"),
]
faq2 = [
    ("お子様やご家族の情報は安全ですか?",
     "データベースとそのバックアップ、領収書の画像を、このアプリ専用の鍵で保管場所ごと暗号化します。"
     "医療機関向けの国のガイドラインでも一般的な保護の水準です。"),
    ("今までのデータは消えませんか?",
     "消えません。スタッフ・お客様・今月の出勤簿を取り込んでから切り替えます。今のスプレッドシートも消さずに残します。"),
    ("スプレッドシートは今後も見られますか?",
     "これまでの分はそのまま見られます。切替後の記録も書き写すかは選べます(見るだけの写しで、直すのはアプリの画面です。今のアプリ側の準備が必要です)。"),
    ("障害が起きたらどうなりますか?",
     "自動で見張り、異常は担当者にメールで届きます。ひとつ前の版やバックアップに戻す手順もあります。"),
]
for part, faq in ((1, faq1), (2, faq2)):
    s = new_slide(f"よくあるご質問({part})", kicker="Q&A")
    compact = len(faq) > 3  # 4問のスライドは1問の高さを詰める
    step = 1.31 if compact else 1.75
    for i, (q, a) in enumerate(faq):
        y = 1.5 + i * step
        if compact:
            card(s, 0.6, y, 12.13, 1.22)
            badge(s, 0.85, y + 0.12, 0.56, "Q", size=20)
            text(s, 1.7, y + 0.08, 10.8, 0.5, q, size=20, color=DEEP, bold=True, anchor=MSO_ANCHOR.MIDDLE)
            text(s, 1.7, y + 0.56, 10.8, 0.62, a, size=16, line=1.15)
        else:
            card(s, 0.6, y, 12.13, 1.58)
            badge(s, 0.85, y + 0.22, 0.62, "Q", size=22)
            text(s, 1.7, y + 0.18, 10.8, 0.62, q, size=21, color=DEEP, bold=True, anchor=MSO_ANCHOR.MIDDLE)
            text(s, 1.7, y + 0.78, 10.8, 0.78, a, size=17, line=1.2)
    notes(s, "ご質問の答えは、新しいアプリの今の作り(2026年9月時点)に合わせています。"
             + ("個人情報は、保管場所ごとの暗号化に加えて、会社ごとの分離・役割ごとにできることの制限・お客様の情報を誰がいつ開いたかの記録・ログインの回数の制限で守ります。"
                if part == 2 else ""))

# 23. 今後の予定
s = new_slide("今後の予定・次のステップ", dark=True, kicker=None)
next_steps = [
    ("1", "本日", "方針のご確認・ご担当者のご相談"),
    ("2", "準備", "本番の環境づくり・データの取り込み"),
    ("3", "試用", "事務局と一部のスタッフで試す"),
    ("4", "切替日", "夜の処理の切り替え・URLと通知のご案内"),
    ("5", "確認", "翌朝の確認・古い仕組みを順に停止"),
]
for i, (n, head, body) in enumerate(next_steps):
    x = 0.6 + i * 2.47
    card(s, x, 1.55, 2.27, 2.75, fill=RGBColor(0x17, 0x62, 0x6F))
    badge(s, x + 0.25, 1.8, 0.62, n, fill=MID, color=DEEP, size=22)
    text(s, x + 0.25, 2.55, 1.9, 0.5, head, size=21, color=WHITE, bold=True)
    text(s, x + 0.25, 3.1, 1.85, 1.15, body, size=16, color=RGBColor(0xDD, 0xF0, 0xEE), line=1.2)
text(s, 0.6, 4.6, 12, 0.45, "切り替え前に開発側で行う準備", size=20, color=MID, bold=True)
prep = [
    "本番の環境(Google Cloud)をつくり、実際の環境での動作を確かめる",
    "会社と最初の管理者の登録/スタッフの自宅住所(道順の出発点)・予定のカレンダーの登録",
    "スマホへの通知の送信の設定/シートへの書き写しを続ける場合、今のアプリ側に受け口を設置",
]
bullets(s, 0.6, 5.1, 12.1, 1.5, prep, size=17, gap=4, mark_color=MID, color=WHITE)
paras = [[("お問い合わせ: ", {"bold": True}), ("ご不明な点は、開発担当までお気軽にご連絡ください。", {})]]
text(s, 0.6, 6.45, 12.1, 0.45, paras, size=16, color=WHITE)
notes(s, "本番の環境の設定ファイルはできていますが、実際のGoogle Cloudでの構築と確認はこれからです。切替日の前に済ませます。")

deck.save(OUT)
