import { AI_PROMPT_KEYS, findAiPromptDefinition } from '@katahimo/shared';
import { describe, expect, it } from 'vitest';
import { reportAiFixtureMasters } from '../../testSupport/reportAiFixtures';
import {
  ageInMonths,
  applyPsi,
  assembleDailyReportPrompt,
  dailyTimeInfo,
  ESCALATION_WARNING,
  enforceEscalationWarning,
  findAgeBand,
  formatChildAge,
  formatKeywordRow,
  renderAccidentReportPrompt,
  renderPromptTemplate,
  resolveUsedKeywords,
  selectKeywordCandidates,
  selectPhrases,
} from './promptAssembly';
import { EMPTY_REPORT_AI_MASTERS, type ReportAiMasters } from './reportAiMasters';

const TEMPLATE = findAiPromptDefinition(AI_PROMPT_KEYS.DAILY_REPORT_GENERATE)?.defaultBody ?? '';
const masters = reportAiFixtureMasters();

const assemble = (
  overrides: Partial<Parameters<typeof assembleDailyReportPrompt>[0]> & { masters?: ReportAiMasters } = {},
) =>
  assembleDailyReportPrompt({
    template: TEMPLATE,
    companyPolicy: '',
    anonymizedText: 'メモ本文',
    timeInfo: '09:00〜12:00',
    childAgeMonths: null,
    educationLevel: null,
    riskRating: null,
    masters,
    ...overrides,
  });

const codes = (list: { code: string }[]) => list.map((k) => k.code);

describe('月齢と年齢帯(STEP1)', () => {
  it('満月齢は基準日の日が生まれた日に達してから数える', () => {
    expect(ageInMonths('2025-01-15', '2026-03-14')).toBe(13);
    expect(ageInMonths('2025-01-15', '2026-03-15')).toBe(14);
    expect(ageInMonths('2026-09-26', '2026-09-26')).toBe(0);
    expect(ageInMonths('2026-09-27', '2026-09-26')).toBeNull();
    expect(ageInMonths('2026/01/01', '2026-09-26')).toBeNull();
    expect(formatChildAge(8)).toBe('8か月（月齢8か月）');
    expect(formatChildAge(14)).toBe('1歳2か月（月齢14か月）');
  });

  it('年齢帯は半開区間 [from, to)(境目の月齢は後の帯)', () => {
    expect(findAgeBand(masters.ageBands, 11)?.label).toBe('0-12ヶ月');
    expect(findAgeBand(masters.ageBands, 12)?.label).toBe('1歳');
    expect(findAgeBand(masters.ageBands, 24)).toBeNull();
  });
});

describe('PSI の適用(STEP2: PSIは教育スコアに優先する)', () => {
  it('PSI 5・4 は★のとおり', () => {
    for (const psi of [5, 4]) {
      expect(applyPsi(5, psi)).toMatchObject({
        effectiveEducationLevel: 5,
        keywordsEnabled: true,
        termNamesForbidden: false,
        escalationRequired: false,
      });
    }
  });

  it('PSI 3 は★を1〜2段下げて★3以下にし、専門語(用語名)を避ける', () => {
    expect([5, 4, 3, 2, 1].map((level) => applyPsi(level, 3).effectiveEducationLevel)).toEqual([
      3, 3, 2, 1, 1,
    ]);
    expect(applyPsi(5, 3)).toMatchObject({ keywordsEnabled: true, termNamesForbidden: true });
  });

  it('PSI 2 は★5でも教育語を使わない(管理者への連絡は要さない)', () => {
    expect(applyPsi(5, 2)).toMatchObject({
      effectiveEducationLevel: null,
      keywordsEnabled: false,
      escalationRequired: false,
    });
  });

  it('PSI 1 は教育語を使わず、管理者へ連絡する', () => {
    expect(applyPsi(5, 1)).toMatchObject({ keywordsEnabled: false, escalationRequired: true });
  });

  it('未入力は★2・PSI 4(通常運用)として絞り込み、管理者への連絡はしない', () => {
    expect(applyPsi(null, null)).toEqual({
      psi: 4,
      rated: false,
      educationLevel: 2,
      effectiveEducationLevel: 2,
      keywordsEnabled: true,
      termNamesForbidden: false,
      escalationRequired: false,
    });
  });
});

describe('キーワードの絞り込み(STEP3: 3つの条件を全て満たす語だけ)', () => {
  const select = (childAgeMonths: number | null, level: number, psi: number, maxKeywords = 2) =>
    codes(
      selectKeywordCandidates({
        keywords: masters.keywords,
        childAgeMonths,
        adjustment: applyPsi(level, psi),
        affinityCodes:
          childAgeMonths === null ? [] : (findAgeBand(masters.ageBands, childAgeMonths)?.keywordCodes ?? []),
        maxKeywords,
      }),
    );

  it('月齢 ∈ [下限, 上限](両端を含む) かつ ★ ∈ 適用★ かつ PSI ≧ PSI下限', () => {
    // 6か月・★5・PSI5: K03(0〜48・★5・PSI4)と K01。K02(36〜)・K04(12〜)は月齢で外れる
    expect(select(6, 5, 5)).toEqual(['K03', 'K01']);
    // 84か月ちょうどは K01・K02 の上限に含まれる
    expect(select(84, 4, 4)).toEqual(['K01', 'K02']);
    // PSI 3 で★5 → ★3: ★5だけの K03、PSI4以上の K03 は外れる
    expect(select(6, 5, 3)).toEqual(['K01']);
    // ★2 の家庭は K04(★2〜5)だけ
    expect(select(30, 2, 5)).toEqual(['K04']);
  });

  it('年齢帯の相性の良いキーワードID の順に先頭へ寄せる', () => {
    expect(select(14, 5, 5)).toEqual(['K04', 'K01', 'K03']);
  });

  it('月齢が分からなければ月齢では絞らない(AI がメモから推定する)', () => {
    expect(select(null, 4, 4)).toEqual(['K01', 'K02', 'K04']);
  });

  it('教育語を使わない(PSI 2 以下・★の1通あたり0個)なら候補は無い', () => {
    expect(select(30, 5, 2)).toEqual([]);
    expect(select(30, 5, 1)).toEqual([]);
    expect(select(30, 5, 5, 0)).toEqual([]);
  });

  it('候補の数の上限', () => {
    expect(
      selectKeywordCandidates({
        keywords: masters.keywords,
        childAgeMonths: null,
        adjustment: applyPsi(5, 5),
        maxKeywords: 2,
        maxCandidates: 2,
      }),
    ).toHaveLength(2);
  });
});

describe('表現(シート05)', () => {
  it('温かみ表現は推奨PSIの範囲、避ける表現は全て', () => {
    expect(selectPhrases(masters.phrases, 'warm', 2).map((p) => p.body)).toEqual([
      'ねぎらいの言葉。',
      '休んでほしい言葉。',
      'また会いたい言葉。',
    ]);
    expect(selectPhrases(masters.phrases, 'warm', 5).map((p) => p.body)).toEqual(['また会いたい言葉。']);
    expect(selectPhrases(masters.phrases, 'avoid', 5)).toHaveLength(1);
  });
});

describe('差し込み(renderPromptTemplate)', () => {
  it('同じ差し込みは全ての箇所を置き換え、差し込んだ値の中の {…}・$& はそのまま残す', () => {
    const rendered = renderPromptTemplate('{timeInfo} / {anonymizedText} / {timeInfo}', {
      anonymizedText: 'メモに {timeInfo} と $& を書いた',
      timeInfo: '9:00〜',
    });
    expect(rendered).toBe('9:00〜 / メモに {timeInfo} と $& を書いた / 9:00〜');
  });

  it('{{name}} は文字の {name} になり、知らない {…}(JSON の例)はそのまま', () => {
    expect(renderPromptTemplate('※ {{psi}} は {psi}。{ "a": 1 } {unknown}', { psi: '3' })).toBe(
      '※ {psi} は 3。{ "a": 1 } {unknown}',
    );
  });

  it('値が空の差し込みだけの行と、条件が偽の範囲は行ごと消える(閉じていない目印は文字として残す)', () => {
    const template = 'A\n{companyPolicy}\nB\n{#keywords}\nC\n{/keywords}\nD\n{#keywords}\nE';
    expect(renderPromptTemplate(template, { companyPolicy: '' }, { keywords: false })).toBe(
      'A\nB\nD\n{#keywords}\nE',
    );
    expect(renderPromptTemplate(template, { companyPolicy: '方針' }, { keywords: true })).toBe(
      'A\n方針\nB\nC\nD\n{#keywords}\nE',
    );
  });

  it('事故報告は入力メモと時間情報だけを差し込む', () => {
    expect(renderAccidentReportPrompt('{anonymizedText}|{timeInfo}|{psi}', 'メモ', '10:00')).toBe(
      'メモ|10:00|{psi}',
    );
    expect(dailyTimeInfo('09:00', undefined)).toBe('時間指定なし');
  });
});

describe('保育日報のプロンプトの組み立て', () => {
  it('マスターが空なら、キーワードの範囲・補足の行は消え、変更案の本文(基本情報・必須情報チェック・出力フォーマット)が残る', () => {
    const { prompt, candidates, adjustment } = assemble({ masters: EMPTY_REPORT_AI_MASTERS });
    expect(candidates).toEqual([]);
    expect(adjustment.escalationRequired).toBe(false);
    for (const gone of [
      '日報キーワード参照ルール',
      '【日報キーワード表】',
      '【温かみ表現】',
      '【避ける表現】',
    ]) {
      expect(prompt).not.toContain(gone);
    }
    expect(prompt).toContain('* 保育時間: 09:00〜12:00');
    expect(prompt).toContain('* 対象児の月齢/年齢: 未入力');
    expect(prompt).toContain('* 教育思考レベル★（1〜5）: 未入力');
    expect(prompt).toContain('* PSI指標（5〜1）: 未入力');
    // 注記の中の変数名は書いたまま
    expect(prompt).toContain(
      '※ {eduLevel}・{psi} が未入力なら eduLevel=2 / psi=4（通常運用）を既定値とする。',
    );
    expect(prompt).toContain('# 必須情報チェック');
    expect(prompt).toContain('2. 【本日のサポート】：次の行に「保育サポート 09:00〜12:00」');
    expect(prompt).toContain('# 入力テキスト\nメモ本文\n');
    // 差し込みの残り・空の差し込みの行・3行以上の空行が無い
    expect(prompt).not.toMatch(/\{(anonymizedText|timeInfo|companyPolicy|keywordTable|childAge)\}/);
    expect(prompt).not.toMatch(/\n\n\n/);
  });

  it('会社の方針は {companyPolicy} の行に入る', () => {
    expect(assemble({ companyPolicy: '株式会社テストの方針です。' }).prompt).toContain(
      '2種類の日報を作成してください。\n株式会社テストの方針です。\n報告をしているスタッフ',
    );
  });

  it('PSI 5・4: ★どおりに候補を表にし、★の書き方・年齢帯・表現・スタンスを添える', () => {
    const { prompt, candidates, maxKeywords } = assemble({
      childAgeMonths: 14,
      educationLevel: 5,
      riskRating: 5,
    });
    expect(codes(candidates)).toEqual(['K04', 'K01', 'K03']);
    expect(maxKeywords).toBe(2);
    expect(prompt).toContain('# 日報キーワード参照ルール（保護者向けレポート『customer』の本文にのみ適用）');
    expect(prompt).toContain(`\n${formatKeywordRow(masters.keywords[2] as never)}\n`);
    expect(prompt).toContain(
      'K01｜テスト分類｜見守りの語｜0〜6歳(0-84)｜3-5｜3｜見守ることの説明。｜① 例文その一。 / ② 例文その二。',
    );
    expect(prompt).not.toContain('K02｜');
    expect(prompt).toContain('【教育思考★5（非常に高い）の書き方】');
    // ★の定義の「3個」は1通あたり2語までに止める
    expect(prompt).toContain('・1通あたり教育語：1〜2個まで');
    expect(prompt).toContain('【年齢帯：1歳（月齢12〜24か月）】');
    expect(prompt).toContain(
      '【温かみ表現】（PSI 5で使える表現。締めなどに自然に添えてよい）\n・また会いたい言葉。',
    );
    expect(prompt).toContain('・次回は〜しましょう（宿題に聞こえる）');
    expect(prompt).toContain(
      '・評価口調：✕ 〜が育っています → ◎ こちらまで息をのみました（評価者にならない）',
    );
    expect(prompt).toContain('* 教育思考レベル★（1〜5）: 5（非常に高い）');
    expect(prompt).toContain('* PSI指標（5〜1）: 5（安心・良好）');
  });

  it('PSI 3: ★を下げた候補だけにし、専門語を避けるよう書く', () => {
    const { prompt, candidates, adjustment } = assemble({
      childAgeMonths: 14,
      educationLevel: 5,
      riskRating: 3,
    });
    expect(adjustment.effectiveEducationLevel).toBe(3);
    expect(codes(candidates)).toEqual(['K04', 'K01']);
    expect(prompt).toContain('・PSI 3（要観察）のため、家庭の★5を★3に下げて控えめにする。専門語は避ける。');
    expect(prompt).toContain('・用語名の扱い：用語名は出さず、親向け説明の言い換えだけを使う');
    expect(prompt).toContain('* PSI指標（5〜1）: 3（要観察(テスト)）');
  });

  it('PSI 2: 教育語を使わず、PSI 2 の温かみ表現から寄り添う', () => {
    const { prompt, candidates, adjustment, maxKeywords } = assemble({
      childAgeMonths: 14,
      educationLevel: 5,
      riskRating: 2,
    });
    expect(candidates).toEqual([]);
    expect(maxKeywords).toBe(0);
    expect(adjustment.escalationRequired).toBe(false);
    expect(prompt).toContain(
      '（PSI 2のため、この日報では教育キーワードを使わない。温かみ表現で寄り添うこと）',
    );
    expect(prompt).toContain(
      '【温かみ表現】（PSI 2のため教育語の代わりに、ここから選んで伴走トーンで寄り添い・締める）',
    );
    expect(prompt).toContain('・休んでほしい言葉。（休息）');
    expect(prompt).not.toContain('の書き方】');
  });

  it('PSI 1: 教育語を使わず、管理者への連絡を要する', () => {
    const { candidates, adjustment, prompt } = assemble({ educationLevel: 5, riskRating: 1 });
    expect(candidates).toEqual([]);
    expect(adjustment.escalationRequired).toBe(true);
    expect(prompt).toContain('* PSI指標（5〜1）: 1（危険・緊急）');
  });

  it('未入力(★・PSI・対象児)は★2・PSI 4 で絞り込み、年齢帯の言葉は渡さない', () => {
    const { prompt, candidates, ageBand } = assemble();
    expect(ageBand).toBeNull();
    expect(codes(candidates)).toEqual(['K04']);
    expect(prompt).not.toContain('【年齢帯：');
    expect(prompt).toContain('【教育思考★2（標準）の書き方】');
    expect(prompt).toContain('・1通あたり教育語：0〜1個まで');
  });

  it('キーワード表はあるが条件に合う語が無いときは、使わないように書く', () => {
    const { prompt } = assemble({ childAgeMonths: 100, educationLevel: 5, riskRating: 5 });
    expect(prompt).toContain(
      '（この家庭・月齢で使える教育キーワードはありません。教育キーワードは使わないこと）',
    );
  });
});

describe('AI の答えの後処理', () => {
  it('使ったキーワードは ID・キーワード名のどちらでも表の行に直し、表に無い答えはそのまま残す', () => {
    expect(
      resolveUsedKeywords(['K01 見守りの語', 'k04', '協力の語', 'K01', 'X99 謎の語', 3], masters.keywords),
    ).toEqual({
      items: [
        { code: 'K01', keyword: '見守りの語', known: true },
        { code: 'K04', keyword: '指先の語', known: true },
        { code: 'K02', keyword: '協力の語', known: true },
        { code: 'X99 謎の語', keyword: null, known: false },
      ],
      keywordIds: [
        '00000000-0000-7000-8000-00000000a001',
        '00000000-0000-7000-8000-00000000a004',
        '00000000-0000-7000-8000-00000000a002',
      ],
      unresolved: ['X99 謎の語'],
    });
    expect(resolveUsedKeywords(undefined, masters.keywords).items).toEqual([]);
  });

  it('PSI 1 の warnings には「管理者へ連絡」が必ず入る(AI が入れていれば足さない)', () => {
    expect(enforceEscalationWarning(['振り返り'])).toEqual(['振り返り', ESCALATION_WARNING]);
    expect(enforceEscalationWarning(['すぐに管理者へ連絡してください'])).toHaveLength(1);
  });
});
