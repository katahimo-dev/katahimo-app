import { autoEndTime, type ClockTime } from './dateTime';

/**
 * 日報ダイアログの入力の状態(GAS版は入力欄のDOMと savedReportsState / assessmentRatings /
 * reportTargetDate に散らばっていたもの)を1つにまとめ、reducer で変える。
 * 画面の見た目の出し分け(結果欄を出すか、ボタンの文言など)は、ここから計算する(selectors)。
 */

export type ReportMode = 'daily' | 'accident';
export type AccidentType = '事故報告' | 'ヒヤリハット';
export type RatingType = 'risk' | 'es';

export interface AccidentFields {
  targetName: string;
  targetDob: string;
  occurrenceTime: string;
  location: string;
  accidentContent: string;
  situation: string;
  immediateResponse: string;
  parentCorrespondence: string;
  diagnosisTreatment: string;
  prevention: string;
}

/** AIが書く事故報告書の項目(対象のお子様の名前・生年月日以外) */
export type AccidentDraftFields = Omit<AccidentFields, 'targetName' | 'targetDob'>;

export interface SavedState {
  /** 保存した報告のID(GAS版の rowIndex)。もう一度保存すると上書きになる */
  reportId: string | null;
  /** 保存後に変えたか */
  isDirty: boolean;
}

export interface ReportFormState {
  mode: ReportMode;
  /** 'YYYY-MM-DD' */
  reportDate: string;
  /** 日付・時刻を直す欄を開いているか(「変える」/「閉じる」) */
  dateTimeEditorOpen: boolean;
  start: ClockTime;
  end: ClockTime;
  memo: string;
  internalText: string;
  customerText: string;
  /** 「⚠️ 足りない情報があります：」の後ろの文(null = 出さない) */
  warnings: string | null;
  /** AIで書けなかった・止めたときの知らせ(null = 出さない)。結果欄を出して手で書けるようにする */
  aiFailure: string | null;
  /** 日報の結果欄(事務局に送る文・保護者に送る文)を出しているか */
  dailyResultShown: boolean;
  /** 事故報告書の下書き欄を出しているか */
  accidentResultShown: boolean;
  accidentType: AccidentType;
  /** 対象のお子様(世帯構成員の番号。'' = 選んでいない) */
  familyIndex: string;
  accident: AccidentFields;
  ratings: Record<RatingType, number>;
  saved: Record<ReportMode, SavedState>;
}

export const EMPTY_ACCIDENT: AccidentFields = {
  targetName: '',
  targetDob: '',
  occurrenceTime: '',
  location: '',
  accidentContent: '',
  situation: '',
  immediateResponse: '',
  parentCorrespondence: '',
  diagnosisTreatment: '',
  prevention: '',
};

const NEW_SAVED: Record<ReportMode, SavedState> = {
  daily: { reportId: null, isDirty: true },
  accident: { reportId: null, isDirty: true },
};

export interface OpenFormOptions {
  today: string;
  /** 前回の始めた時間(localStorage。無ければ 09:00) */
  lastStart: ClockTime;
  /** 前回の起きた時間(localStorage) */
  lastAccidentTime: string;
}

/** ダイアログを開いたときの状態(GAS版 openModal の「Reset form」) */
export function createInitialForm({ today, lastStart, lastAccidentTime }: OpenFormOptions): ReportFormState {
  return {
    mode: 'daily',
    reportDate: today,
    dateTimeEditorOpen: false,
    start: lastStart,
    end: autoEndTime(lastStart) ?? { hour: '11', minute: '00' },
    memo: '',
    internalText: '',
    customerText: '',
    warnings: null,
    aiFailure: null,
    dailyResultShown: false,
    accidentResultShown: false,
    accidentType: '事故報告',
    familyIndex: '',
    accident: { ...EMPTY_ACCIDENT, occurrenceTime: lastAccidentTime },
    ratings: { risk: 0, es: 0 },
    saved: NEW_SAVED,
  };
}

export type ReportFormAction =
  | { type: 'reset'; state: ReportFormState }
  | { type: 'switchMode'; mode: ReportMode }
  | { type: 'toggleDateTimeEditor' }
  | { type: 'setDate'; date: string }
  | { type: 'setStart'; start: ClockTime }
  | { type: 'setEnd'; end: ClockTime }
  | { type: 'setMemo'; memo: string }
  | { type: 'appendMemo'; text: string }
  | { type: 'setDailyText'; field: 'internalText' | 'customerText'; value: string }
  | { type: 'setAccidentField'; field: keyof AccidentFields; value: string }
  | { type: 'setAccidentType'; accidentType: AccidentType }
  | { type: 'selectFamily'; index: string; member: { name: string; dob: string } | null }
  | { type: 'setRating'; rating: RatingType; score: number }
  | { type: 'markDirty' }
  | { type: 'dailyGenerated'; internal: string; customer: string; warnings: string | null }
  | { type: 'showWarnings'; message: string }
  | { type: 'aiStarted' }
  | { type: 'openManualEntry'; message: string }
  | { type: 'accidentGenerated'; draft: AccidentDraftFields }
  | { type: 'saved'; mode: ReportMode; reportId: string };

export function reportFormReducer(state: ReportFormState, action: ReportFormAction): ReportFormState {
  switch (action.type) {
    case 'reset':
      return action.state;
    case 'switchMode':
      // GAS版 switchMode: 結果欄は「中身があるか」で出し直す(事故は「何が起きたか」の中身で判定)
      return {
        ...state,
        mode: action.mode,
        dailyResultShown: action.mode === 'daily' ? state.internalText !== '' : state.dailyResultShown,
        accidentResultShown:
          action.mode === 'accident'
            ? state.accident.accidentContent.trim() !== ''
            : state.accidentResultShown,
      };
    case 'toggleDateTimeEditor':
      return { ...state, dateTimeEditorOpen: !state.dateTimeEditorOpen };
    case 'setDate':
      return { ...state, reportDate: action.date };
    case 'setStart':
      // 始めた時間を変えたら、終わった時間は2時間後にそろえる(GAS版 autoSetEndTime)
      return { ...state, start: action.start, end: autoEndTime(action.start) ?? state.end };
    case 'setEnd':
      return { ...state, end: action.end };
    case 'setMemo':
      return { ...state, memo: action.memo };
    case 'appendMemo':
      return { ...state, memo: (state.memo ? `${state.memo}\n` : '') + action.text };
    case 'setDailyText':
      return { ...state, [action.field]: action.value };
    case 'setAccidentField':
      return { ...state, accident: { ...state.accident, [action.field]: action.value } };
    case 'setAccidentType':
      return { ...state, accidentType: action.accidentType };
    case 'selectFamily':
      return {
        ...state,
        familyIndex: action.index,
        accident: {
          ...state.accident,
          targetName: action.member?.name ?? '',
          targetDob: action.member?.dob ?? '',
        },
      };
    case 'setRating': {
      // 1番目の★が選ばれているときにもう一度押すと、未評価(0)に戻す
      const current = state.ratings[action.rating];
      const score = action.score === 1 && current === 1 ? 0 : action.score;
      return { ...state, ratings: { ...state.ratings, [action.rating]: score } };
    }
    case 'markDirty': {
      const saved = state.saved[state.mode];
      if (saved.isDirty) return state;
      return { ...state, saved: { ...state.saved, [state.mode]: { ...saved, isDirty: true } } };
    }
    case 'dailyGenerated':
      return {
        ...state,
        internalText: action.internal,
        customerText: action.customer,
        warnings: action.warnings,
        aiFailure: null,
        dailyResultShown: true,
      };
    case 'showWarnings':
      return { ...state, warnings: action.message };
    case 'aiStarted':
      return { ...state, aiFailure: null };
    case 'openManualEntry':
      // AIで書けなくても送れるよう、いまの画面の結果欄(書いてあった文はそのまま)と保存ボタンを出す
      return state.mode === 'daily'
        ? { ...state, aiFailure: action.message, dailyResultShown: true }
        : { ...state, aiFailure: action.message, accidentResultShown: true };
    case 'accidentGenerated':
      return {
        ...state,
        accident: { ...state.accident, ...action.draft },
        aiFailure: null,
        accidentResultShown: true,
      };
    case 'saved':
      return {
        ...state,
        saved: { ...state.saved, [action.mode]: { reportId: action.reportId, isDirty: false } },
      };
  }
}

// ── 画面の出し分け ──

/** AIの結果がもうあるか(結果欄の表示ではなく中身で判定。GAS版 updateGenerateButtonUI_) */
export function hasGeneratedResult(state: ReportFormState): boolean {
  const content = state.mode === 'daily' ? state.internalText : state.accident.accidentContent;
  return content.trim() !== '';
}

export function generateButtonLabel(state: ReportFormState): string {
  if (hasGeneratedResult(state)) return 'もう一度AIに書いてもらう';
  return state.mode === 'daily' ? '✨ AIに日報を書いてもらう' : '✨ AIに報告書の下書きを作ってもらう';
}

/** 保存ボタンを出すか(結果欄と一緒に出す) */
export function isSaveButtonShown(state: ReportFormState): boolean {
  return state.mode === 'daily' ? state.dailyResultShown : state.accidentResultShown;
}

/** 「✅ 保存しました」の状態か(保存したあと何も変えていない) */
export function isSavedAndClean(state: ReportFormState): boolean {
  const saved = state.saved[state.mode];
  return Boolean(saved.reportId) && !saved.isDirty;
}

/** 保護者に送る文の最後に、スタッフの苗字を添える(GAS版 onReportGenerated) */
export function appendStaffSurname(customerText: string, staffName: string): string {
  if (!staffName) return customerText;
  const [surname] = staffName.split(/[\s　]+/);
  return surname !== undefined ? `${customerText}\n\n${surname}` : customerText;
}

/** 生成の結果が「失敗」(APIキー未設定・APIエラー)か */
export function isDailyDraftApiError(warnings: readonly string[]): boolean {
  return warnings.some((w) => w === 'API Error' || w === 'API Key Missing');
}
