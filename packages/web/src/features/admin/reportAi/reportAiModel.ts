import {
  REPORT_PHRASE_KIND_LABELS,
  REPORT_PHRASE_KINDS,
  type ReportAiLevelKind,
  type ReportAiMastersResponse,
  type ReportAiRowKind,
  TERM_NAME_POLICIES,
  TERM_NAME_POLICY_LABELS,
} from '@katahimo/shared';

/**
 * 管理画面「日報AIの調整」の編集の形(お客様の日報キーワード表現マスターの列と同じ項目)。入力は文字で持ち、
 * 保存のときに API の形(数・ID の並び・空は null)にする。値の範囲の確かめはサーバー(契約)が行う。
 */

export type RowTable = 'keywords' | 'ageBands' | 'phrases' | 'stanceRules';
export type LevelTable = 'educationLevels' | 'psiLevels';
export type EditorTable = RowTable | LevelTable;

export const ROW_KIND_OF: Record<RowTable, ReportAiRowKind> = {
  keywords: 'keywords',
  ageBands: 'age-bands',
  phrases: 'phrases',
  stanceRules: 'stance-rules',
};
export const LEVEL_KIND_OF: Record<LevelTable, ReportAiLevelKind> = {
  educationLevels: 'education-levels',
  psiLevels: 'psi-levels',
};

type FieldType = 'text' | 'textarea' | 'number' | 'select' | 'codes';

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  /** 空にできない項目(文字は空を拒み、数は入力が要る)。 */
  required?: boolean;
  options?: readonly { value: string; label: string }[];
  hint?: string;
}

const text = (key: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({
  key,
  label,
  type: 'text',
  ...extra,
});
const area = (key: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({
  key,
  label,
  type: 'textarea',
  ...extra,
});
const num = (key: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({
  key,
  label,
  type: 'number',
  required: true,
  ...extra,
});

export const EDITOR_FIELDS: Record<EditorTable, readonly FieldDef[]> = {
  keywords: [
    text('code', 'ID', { required: true, hint: '例）K01(半角英数字。取込ではこの ID で同じ行を探します)' }),
    text('keyword', 'キーワード', { required: true }),
    text('category', 'カテゴリ'),
    text('subConcept', 'サブ概念'),
    text('ageLabel', '対象年齢(表示)', { hint: '例）3〜6歳' }),
    num('ageFromMonths', '年齢下限(月齢)'),
    num('ageToMonths', '年齢上限(月齢)', { hint: '上限の月齢も含みます' }),
    text('ageBandLabel', '適用年齢帯(表示)'),
    num('educationLevelMin', '教育思考★の下限'),
    num('educationLevelMax', '教育思考★の上限'),
    num('psiMin', 'PSI下限', { hint: 'PSI がこの値以上のときだけ使います' }),
    text('tone', 'トーン種別'),
    area('parentExplanation', '親向け説明(やさしい言い換え)'),
    area('phraseExamples', '日報フレーズ例(見ていた人スタンス)', { hint: '1行に1つ' }),
    area('usageScene', '使いどころ・場面'),
    area('ngExample', 'この語でのNG例'),
    num('sortOrder', '並び順'),
  ],
  ageBands: [
    text('label', '年齢帯', { required: true, hint: '例）1歳' }),
    num('ageFromMonths', '月齢の下限'),
    num('ageToMonths', '月齢の上限', { hint: '上限の月齢は次の帯に入ります(0〜6ヶ月の6ヶ月は次の帯)' }),
    area('behaviorWords', 'この時期によく描写する行動・単語'),
    area('developmentTopics', '発達の主なトピック'),
    {
      key: 'keywordCodes',
      label: '相性の良いキーワードID',
      type: 'codes',
      hint: '空白で区切る。例）K11 K12',
    },
    text('sceneExamples', '場面例'),
    num('sortOrder', '並び順'),
  ],
  phrases: [
    {
      key: 'kind',
      label: '区分',
      type: 'select',
      required: true,
      options: REPORT_PHRASE_KINDS.map((k) => ({ value: k, label: REPORT_PHRASE_KIND_LABELS[k] })),
    },
    area('body', '表現例／避ける言い回し', { required: true }),
    text('message', '込めるメッセージ／理由'),
    num('psiMin', '推奨PSIの下限', { hint: '✕避ける はPSIに関わらず全ての日報で使いません' }),
    num('psiMax', '推奨PSIの上限'),
    text('note', '備考', { hint: '例）締めに' }),
    num('sortOrder', '並び順'),
  ],
  stanceRules: [
    text('topic', '項目', { required: true }),
    area('avoidText', '✕避ける(上から目線・評価)'),
    area('recommendedText', '◎推奨(見ていた人・共感)'),
    text('reason', '理由'),
    num('sortOrder', '並び順'),
  ],
  educationLevels: [
    text('label', '呼称'),
    area('customerProfile', '想定顧客像'),
    area('usage', '教育語の使い方'),
    area('wordScope', '使ってよい語の範囲'),
    text('termNameRule', '用語名の扱い(文言)'),
    {
      key: 'termNamePolicy',
      label: '用語名の扱い(AI への指示)',
      type: 'select',
      required: true,
      options: TERM_NAME_POLICIES.map((p) => ({ value: p, label: TERM_NAME_POLICY_LABELS[p] })),
    },
    num('keywordsMin', '1通あたり教育語の下限'),
    num('keywordsMax', '1通あたり教育語の上限', { hint: '2個より多くしても、1通あたり2語までにします' }),
    text('toneFocus', 'トーンの主眼'),
    area('exampleDirection', '例文の方向性'),
  ],
  psiLevels: [text('label', '定義', { required: true }), area('criteria', '判定基準')],
};

export type FormValues = Record<string, string>;

type AnyRow = Record<string, unknown>;

/** 行(無ければ新しい行の既定値)を入力の形にする。 */
export function formOf(table: EditorTable, row: AnyRow | null): FormValues {
  const values: FormValues = {};
  for (const field of EDITOR_FIELDS[table]) {
    const value = row?.[field.key];
    if (field.type === 'codes') values[field.key] = Array.isArray(value) ? value.join(' ') : '';
    else if (value === null || value === undefined)
      values[field.key] = row ? '' : (DEFAULTS[table][field.key] ?? '');
    else values[field.key] = String(value);
  }
  return values;
}

/** 新しい行の既定値(書かれていない項目は空)。 */
const DEFAULTS: Record<EditorTable, FormValues> = {
  keywords: {
    ageFromMonths: '0',
    ageToMonths: '84',
    educationLevelMin: '3',
    educationLevelMax: '5',
    psiMin: '3',
    sortOrder: '0',
  },
  ageBands: { ageFromMonths: '0', ageToMonths: '12', sortOrder: '0' },
  phrases: { kind: 'warm', psiMin: '1', psiMax: '5', sortOrder: '0' },
  stanceRules: { sortOrder: '0' },
  educationLevels: { termNamePolicy: 'forbid', keywordsMin: '0', keywordsMax: '1' },
  psiLevels: {},
};

/** 入力を API の行にする。入力の誤り(数でない・必須が空)があれば項目ごとの文言を返す。 */
export function rowOf(
  table: EditorTable,
  values: FormValues,
): { row: AnyRow; errors: null } | { row: null; errors: Record<string, string> } {
  const row: AnyRow = {};
  const errors: Record<string, string> = {};
  for (const field of EDITOR_FIELDS[table]) {
    const raw = (values[field.key] ?? '').trim();
    if (field.type === 'number') {
      if (!/^\d+$/.test(raw)) errors[field.key] = '0以上の整数を入れてください';
      else row[field.key] = Number(raw);
    } else if (field.type === 'codes') {
      row[field.key] = raw.split(/[\s,、]+/).filter(Boolean);
    } else if (field.required) {
      if (!raw) errors[field.key] = `${field.label}を入れてください`;
      row[field.key] = raw;
    } else {
      row[field.key] = raw === '' ? null : raw;
    }
  }
  return Object.keys(errors).length > 0 ? { row: null, errors } : { row, errors: null };
}

type Masters = ReportAiMastersResponse;

/** 一覧の1行の見出しと補足(画面に並べる)。 */
export function summaryOf(table: EditorTable, row: AnyRow): { title: string; detail: string } {
  switch (table) {
    case 'keywords': {
      const k = row as Masters['keywords'][number];
      return {
        title: `${k.code} ${k.keyword}`,
        detail: `月齢${k.ageFromMonths}〜${k.ageToMonths}・★${k.educationLevelMin}〜${k.educationLevelMax}・PSI${k.psiMin}以上${k.category ? `・${k.category}` : ''}`,
      };
    }
    case 'ageBands': {
      const b = row as Masters['ageBands'][number];
      return {
        title: b.label,
        detail: `月齢${b.ageFromMonths}〜${b.ageToMonths}${b.keywordCodes.length > 0 ? `・${b.keywordCodes.join(' ')}` : ''}`,
      };
    }
    case 'phrases': {
      const p = row as Masters['phrases'][number];
      return {
        title: `${REPORT_PHRASE_KIND_LABELS[p.kind]} ${p.body}`,
        detail:
          p.kind === 'avoid'
            ? '全ての日報で使わない'
            : `PSI ${p.psiMin}〜${p.psiMax}${p.note ? `・${p.note}` : ''}`,
      };
    }
    case 'stanceRules': {
      const s = row as Masters['stanceRules'][number];
      return { title: s.topic, detail: `✕ ${s.avoidText ?? ''} → ◎ ${s.recommendedText ?? ''}` };
    }
    case 'educationLevels': {
      const l = row as Masters['educationLevels'][number];
      return {
        title: `★${l.level} ${l.label ?? ''}`,
        detail: `1通あたり教育語 ${l.keywordsMin}〜${l.keywordsMax}個・用語名は${TERM_NAME_POLICY_LABELS[l.termNamePolicy]}`,
      };
    }
    default: {
      const p = row as Masters['psiLevels'][number];
      return { title: `PSI ${p.level} ${p.label}`, detail: p.criteria?.split('\n')[0] ?? '' };
    }
  }
}
