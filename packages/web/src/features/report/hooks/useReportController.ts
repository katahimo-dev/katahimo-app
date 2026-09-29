import type { DailyReportAiInfo } from '@katahimo/shared';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { ApiRequestError, isUnauthenticated, userMessageOf } from '../../../api/client';
import { customerQueryKeys, customersApi } from '../../../api/customers';
import { reportsApi } from '../../../api/reports';
import { useUiConfig } from '../../../app/uiConfig/useUiConfig';
import { jstHHmm, todayJst } from '../../../lib/date';
import { pushRecentCustomer } from '../../../lib/recentCustomers';
import {
  readStorage,
  STORAGE_KEYS,
  type UserStorageScope,
  userStorageKey,
  writeStorage,
} from '../../../lib/storage';
import { useTodayJst } from '../../../lib/useTodayJst';
import { confirmNative, useConfirmModal } from '../../../ui/confirm';
import { hideToast, showActionToast, showErrorToast, showToast } from '../../../ui/toast';
import { type ToastAction, toastStore } from '../../../ui/toast/toastStore';
import { useSession } from '../../auth';
import { useCustomerReportProfile } from '../../customers/useCustomerReportProfile';
import { type ClockTime, formatClock, receiptFallbackTimestamp, shiftReportDate } from '../model/dateTime';
import {
  applyDraftToForm,
  buildDraftSnapshot,
  clearPendingDraft,
  DISCARD_DRAFT_CONFIRM,
  DISCARD_DRAFT_LABEL,
  discardDraftFromForm,
  draftRestoredMessage,
  readPendingDraft,
  writePendingDraft,
} from '../model/reportDraft';
import {
  type AccidentFields,
  type AccidentType,
  appendStaffSurname,
  createInitialForm,
  isDailyDraftApiError,
  type RatingType,
  type ReportFormAction,
  type ReportMode,
  reportFormReducer,
} from '../model/reportForm';
import type { ReportSession } from '../types';
import { useReceipts } from './useReceipts';

/**
 * AI生成・保存の見張り時間。保存はこれを過ぎたらボタンを押せる状態に戻して知らせる。AI生成は1つのモデルへの
 * 問い合わせをここで切り、次のモデルで試す。
 */
const WATCHDOG_MS = 90_000;

const STOPPED_MESSAGE = 'AIを止めました。下の欄に手で書いて「保存する」を押してください。';

/** AIで書けなかったときの知らせ(試したモデルと、最後の理由) */
function failureMessage(tried: readonly string[], reason: string): string {
  const models = tried.length > 0 ? `（試したモデル: ${tried.join(' → ')}）` : '';
  return `AIで書けませんでした${models}。下の欄に手で書いて「保存する」を押してください。${reason ? `\n理由: ${reason}` : ''}`;
}

/** AI生成の途中の様子(いま試しているモデル。画面に出す) */
export interface AiProgress {
  /** いま試しているモデル(null = サーバーが選ぶ既定のモデル。順番が読めなかったとき) */
  model: string | null;
  /** 何番目か(1から) */
  attempt: number;
  total: number;
  /** ここまでに書けなかったモデル */
  failed: string[];
  /**
   * モデルを切り替えたときの一言(「〇〇 で書けなかったので、△△ で試しています」。無ければ null)。
   * トーストにすると下の「⏹ 止めて手で書く」に重なって押しにくいため、ボタンの下に文字で出す
   */
  notice: string | null;
}

/**
 * 1つのモデルでの生成の結果(日報・事故報告で同じ形にして、同じ切り替えの手順で扱う)。
 * 書けたら ok と、結果を画面に入れる処理(ボタンを元に戻してから呼ぶ)。書けなければ理由と、次のモデルで試す意味があるか。
 */
type ModelGeneration =
  | { ok: true; model: string | null; show: () => void }
  | { ok: false; model: string | null; reason: string; retryable: boolean };

interface GenerationRun {
  /** 止めた理由(⏹ 止める / 開き直し。null = 動いている) */
  stopped: 'stopped' | 'reopened' | null;
  /** いまの問い合わせ(止めるときに切る) */
  controller: AbortController | null;
}

type AttemptOutcome<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'stopped' }
  | { kind: 'reopened' }
  | { kind: 'timeout' }
  | { kind: 'error'; error: unknown };

export const OVERWRITE_CONFIRM_TITLE = '前に保存した日報を、今の内容に書きかえますか？';

export interface ReportCustomer {
  id: string;
  name: string;
  address: string;
  family: { id: string; name: string; dob: string }[];
}

export type VisitCompleteState = { status: 'idle' } | { status: 'sending' } | { status: 'sent'; at: string };

export type ScrollTarget = 'warnings' | 'accidentResult';

export interface HintContent {
  title: string;
  body: { kind: 'text'; text: string } | { kind: 'assessment'; type: RatingType };
}

/** 今日(業務日はJST) */
const today = () => todayJst();

function lastStartTime(scope: UserStorageScope): ClockTime {
  return {
    hour: readStorage(userStorageKey(STORAGE_KEYS.lastStartHour, scope)) || '09',
    minute: readStorage(userStorageKey(STORAGE_KEYS.lastStartMinute, scope)) || '00',
  };
}

/**
 * 日報ダイアログの中身の状態と操作をまとめたフック(GAS版 openModal〜executeSave の処理)。
 * ダイアログを開くたび(session.nonce が変わるたび)に入力を初めの状態に戻し、書きかけがあれば戻す。
 */
export function useReportController(session: ReportSession | null) {
  const { user, storageScope } = useSession();
  const confirm = useConfirmModal();
  const { data: uiConfig } = useUiConfig();
  // 開いたまま日付をまたいだら描き直す(▶ 次の日へ の押せる/押せないを今日で決め直す。書いている日付は変えない)
  const currentToday = useTodayJst();

  // GAS版はページを開いたときに 09:00〜11:00・今日で始まる(お客様の指定なしの領収書はこの値を使う)
  const [initialForm] = useState(() =>
    createInitialForm({ today: today(), lastStart: { hour: '09', minute: '00' }, lastAccidentTime: '' }),
  );
  const [form, dispatch] = useReducer(reportFormReducer, initialForm);
  /**
   * いちばん新しい入力の状態。変える操作はすべて apply() を通し、reducer で次の状態をその場で計算して
   * ここにも入れる(await のあとや、書きかけの退避で、描画を待たずに最新の値を読めるように)。
   */
  const formRef = useRef(initialForm);
  const apply = useCallback((action: ReportFormAction) => {
    formRef.current = reportFormReducer(formRef.current, action);
    dispatch(action);
  }, []);
  const receipts = useReceipts(storageScope);
  /** お客様の指定なしの領収書で、いまの写真に使う既定の日時(fallbackTimestampForSend) */
  const standaloneFallbackRef = useRef<string | null>(null);
  const noReceiptImages = receipts.images.length === 0;
  useEffect(() => {
    if (noReceiptImages) standaloneFallbackRef.current = null;
  }, [noReceiptImages]);
  const writeLastAccidentTime = (value: string) =>
    writeStorage(userStorageKey(STORAGE_KEYS.lastAccidentTime, storageScope), value);
  const [generatingSince, setGeneratingSince] = useState<number | null>(null);
  const [aiProgress, setAiProgress] = useState<AiProgress | null>(null);
  const generationRunRef = useRef<GenerationRun | null>(null);
  const [savingSince, setSavingSince] = useState<number | null>(null);
  const [visitComplete, setVisitComplete] = useState<VisitCompleteState>({ status: 'idle' });
  const [unregisteredName, setUnregisteredName] = useState('');
  const [hint, setHint] = useState<HintContent | null>(null);
  const [hintOpen, setHintOpen] = useState(false);
  const [scrollRequest, setScrollRequest] = useState<{ target: ScrollTarget; seq: number } | null>(null);

  const warningsRef = useRef<HTMLDivElement>(null);
  const accidentResultRef = useRef<HTMLDivElement>(null);
  const scrollRefs = useMemo(() => ({ warnings: warningsRef, accidentResult: accidentResultRef }), []);

  const nonce = session?.nonce ?? 0;
  const nonceRef = useRef(nonce);
  const generatingRef = useRef<number | null>(null);
  const savingRef = useRef<number | null>(null);
  /** 書きかけを戻したお知らせの「破棄する」(AI を始めたときに、ほかのボタンつきのお知らせと分けて消すため) */
  const draftToastActionRef = useRef<ToastAction | null>(null);

  // ── お客様 ──
  const customerId = session?.kind === 'customer' ? session.target.customerId : null;
  const detailQuery = useQuery({
    // お客様タブの「お客様の情報」と同じクエリ(読み取りだけ。同じお客様なら読み込み済みの内容を使う)
    queryKey: customerQueryKeys.detail(customerId ?? ''),
    queryFn: ({ signal }) => customersApi.detail(customerId as string, signal),
    enabled: customerId !== null,
    staleTime: 5 * 60 * 1000,
  });
  const detail = detailQuery.data?.customer;
  const customer: ReportCustomer | null =
    session?.kind === 'customer'
      ? {
          id: session.target.customerId,
          name: detail?.name ?? session.target.customerName,
          address: detail?.addressDetail ?? '',
          family: (detail?.familyMembers ?? []).map((m) => ({ id: m.id, name: m.name, dob: m.dob ?? '' })),
        }
      : null;
  const customerRef = useRef(customer);
  useLayoutEffect(() => {
    customerRef.current = customer;
  });

  // ── 日報AIの言葉選び(対象のお子様・家庭の教育思考★・最後の生成の結果) ──
  /** 日報の対象のお子様(世帯構成員の ID。'' = 選ばない) */
  const [dailyChildId, setDailyChildId] = useState('');
  const dailyChildRef = useRef('');
  /** 最後に AI に書いてもらったときの日報AIの情報(使った言葉・管理者への連絡・保存で結び付ける記録の ID) */
  const [aiInfo, setAiInfo] = useState<DailyReportAiInfo | null>(null);
  const aiInfoRef = useRef<DailyReportAiInfo | null>(null);
  const selectDailyChild = useCallback((childId: string) => {
    dailyChildRef.current = childId;
    setDailyChildId(childId);
  }, []);
  const rememberAiInfo = useCallback((info: DailyReportAiInfo | null) => {
    aiInfoRef.current = info;
    setAiInfo(info);
  }, []);
  const reportProfile = useCustomerReportProfile(customerId);

  // ── 開くたびに初めの状態に戻す(GAS版 openModal / openStandaloneReceiptModal) ──
  // biome-ignore lint/correctness/useExhaustiveDependencies: 開き直したとき(nonce が変わったとき)だけ戻す
  useLayoutEffect(() => {
    if (!session) return;
    nonceRef.current = session.nonce;
    receipts.reset();
    standaloneFallbackRef.current = null;
    setUnregisteredName('');
    if (session.kind === 'standalone') return; // GAS版は日報の入力には触らない(隠すだけ)
    cancelAttempt('reopened');
    generationRunRef.current = null;
    generatingRef.current = null;
    setAiProgress(null);
    savingRef.current = null;
    setGeneratingSince(null);
    setSavingSince(null);
    setVisitComplete({ status: 'idle' });
    selectDailyChild('');
    rememberAiInfo(null);
    const fresh = createInitialForm({
      today: today(),
      lastStart: lastStartTime(storageScope),
      lastAccidentTime: readStorage(userStorageKey(STORAGE_KEYS.lastAccidentTime, storageScope)) || '',
    });
    // 保存していない入力が残っていれば、どのお客様を開いたときでもまず戻して見せる(GAS版と同じ)。
    // 間違えたお客様で書き始めたときなど、要らない書きかけはお知らせの「破棄する」で消せる(GAS版には無い)
    const draft = readPendingDraft(storageScope);
    apply({ type: 'reset', state: draft ? applyDraftToForm(fresh, draft) : fresh });
    if (!draft) return;
    const openedNonce = session.nonce;
    const action: ToastAction = {
      label: DISCARD_DRAFT_LABEL,
      run: () => {
        if (!confirmNative(DISCARD_DRAFT_CONFIRM)) {
          showActionToast(draftRestoredMessage(draft), action, true);
          return;
        }
        clearPendingDraft(storageScope);
        draftToastActionRef.current = null;
        // 開き直した後なら、いまのダイアログは書きかけを戻していないので入力には触らない
        if (nonceRef.current !== openedNonce) return;
        rememberAiInfo(null);
        apply({ type: 'reset', state: discardDraftFromForm(formRef.current, fresh) });
        showToast('書きかけを破棄しました');
      },
    };
    draftToastActionRef.current = action;
    showActionToast(draftRestoredMessage(draft), action, true);
  }, [nonce]);

  // 世帯構成員が読めたら、1人目を事故報告の「対象のお子様」に選んでおく(GAS版 openModal の Auto Select first
  // child)。日報のお子様は1人だけのときだけ選んでおく(何人もいれば、スタッフが選ぶ)
  const familyInitNonceRef = useRef<number | null>(null);
  useEffect(() => {
    if (session?.kind !== 'customer' || !detail || familyInitNonceRef.current === session.nonce) return;
    familyInitNonceRef.current = session.nonce;
    const first = detail.familyMembers[0];
    apply({
      type: 'selectFamily',
      index: first ? '0' : '',
      member: first ? { name: first.name, dob: first.dob ?? '' } : null,
    });
    if (detail.familyMembers.length === 1 && first) selectDailyChild(first.id);
  }, [session, detail, apply, selectDailyChild]);

  // ── 書きかけの退避(GAS版 markDirty → saveReportDraftSnapshot) ──
  /** いまの入力(apply 済みの最新の状態)を退避する */
  const saveSnapshot = useCallback(
    (mode: ReportMode) => {
      const target = customerRef.current;
      if (!target) return;
      writePendingDraft(buildDraftSnapshot(formRef.current, target, mode, Date.now()), storageScope);
    },
    [storageScope],
  );

  /** 入力欄が変わった(保存ボタンを「保存する」に戻し、書きかけを退避する) */
  const markEdited = useCallback(() => {
    apply({ type: 'markDirty' });
    saveSnapshot(formRef.current.mode);
  }, [apply, saveSnapshot]);

  const edit = useCallback(
    (action: ReportFormAction) => {
      apply(action);
      markEdited();
    },
    [apply, markEdited],
  );

  // ── スクロール ──
  useEffect(() => {
    if (!scrollRequest) return;
    const el = scrollRefs[scrollRequest.target].current;
    el?.scrollIntoView({
      behavior: 'smooth',
      block: scrollRequest.target === 'warnings' ? 'center' : 'start',
    });
  }, [scrollRequest, scrollRefs]);
  const scrollTo = (target: ScrollTarget) =>
    setScrollRequest((prev) => ({ target, seq: (prev?.seq ?? 0) + 1 }));

  // ── 入力の操作 ──
  const actions = {
    switchMode: (mode: ReportMode) => apply({ type: 'switchMode', mode }),
    toggleDateTimeEditor: () => apply({ type: 'toggleDateTimeEditor' }),
    changeDate: (offset: number) => {
      const next = shiftReportDate(formRef.current.reportDate, offset, today());
      if (next) apply({ type: 'setDate', date: next });
    },
    setStart: (start: ClockTime) => {
      writeStorage(userStorageKey(STORAGE_KEYS.lastStartHour, storageScope), start.hour);
      writeStorage(userStorageKey(STORAGE_KEYS.lastStartMinute, storageScope), start.minute);
      edit({ type: 'setStart', start });
    },
    setEnd: (end: ClockTime) => edit({ type: 'setEnd', end }),
    setMemo: (memo: string) => edit({ type: 'setMemo', memo }),
    appendMemo: (text: string) => edit({ type: 'appendMemo', text }),
    setDailyText: (field: 'internalText' | 'customerText', value: string) =>
      edit({ type: 'setDailyText', field, value }),
    setAccidentField: (field: keyof AccidentFields, value: string) => {
      if (field === 'occurrenceTime') writeLastAccidentTime(value);
      edit({ type: 'setAccidentField', field, value });
    },
    setAccidentType: (accidentType: AccidentType) => edit({ type: 'setAccidentType', accidentType }),
    selectFamily: (index: string) => {
      const member = index === '' ? null : (customerRef.current?.family[Number(index)] ?? null);
      edit({ type: 'selectFamily', index, member });
    },
    setRating: (rating: RatingType, score: number) => apply({ type: 'setRating', rating, score }),
    setUnregisteredName: (name: string) => {
      setUnregisteredName(name);
      markEdited();
    },
    markEdited,
  };

  // ── ヒント(GAS版 toggleHint / showAssessmentHint) ──
  const openWritingHint = () => {
    const isHiyari = formRef.current.mode === 'accident' && formRef.current.accidentType === 'ヒヤリハット';
    setHint(
      isHiyari
        ? {
            title: 'ヒヤリハットの書き方ヒント',
            body: {
              kind: 'text',
              text: uiConfig?.hiyariPlaceholder || 'ヒヤリハットの状況を入力してください...',
            },
          }
        : {
            title: '事故報告書の書き方ヒント',
            body: { kind: 'text', text: uiConfig?.accidentHint || 'Loading...' },
          },
    );
    setHintOpen(true);
  };
  const openAssessmentHint = (type: RatingType) => {
    const definition = uiConfig?.assessments[type];
    if (!definition) {
      showToast('設定を読み込み中、または設定がありません');
      return;
    }
    setHint({ title: `${definition.title} 指標`, body: { kind: 'assessment', type } });
    setHintOpen(true);
  };

  // ── AIに書いてもらう(GAS版 generateReport / onReportGenerated / onAccidentReportGenerated) ──
  /** いまの AI への1回の問い合わせを止める(⏹ 止める・開き直し) */
  const cancelAttempt = useCallback((reason: 'stopped' | 'reopened') => {
    const run = generationRunRef.current;
    if (!run) return;
    run.stopped = reason;
    run.controller?.abort();
  }, []);

  /**
   * 1回の問い合わせ(見張り時間を過ぎたら切って timeout、⏹ 止めるなら stopped。ほかの失敗は error)。
   * 止める・時間切れは通信の失敗より先に判定する(切ったことで起きた AbortError をエラーとして出さない)。
   */
  const runAttempt = async <T>(run: GenerationRun, call: (signal: AbortSignal) => Promise<T>) => {
    const controller = new AbortController();
    run.controller = controller;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, WATCHDOG_MS);
    const outcome = (): AttemptOutcome<T> | null =>
      run.stopped ? { kind: run.stopped } : timedOut ? { kind: 'timeout' } : null;
    // 切ったらすぐ戻る(通信が切れるのを待たない)
    const aborted = new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
    });
    aborted.catch(() => undefined);
    try {
      if (run.stopped) return { kind: run.stopped } as AttemptOutcome<T>;
      const value = await Promise.race([call(controller.signal), aborted]);
      return outcome() ?? ({ kind: 'ok', value } as AttemptOutcome<T>);
    } catch (error) {
      return outcome() ?? ({ kind: 'error', error } as AttemptOutcome<T>);
    } finally {
      clearTimeout(timer);
      if (run.controller === controller) run.controller = null;
    }
  };

  /** AIで書けなかった・止めた: 知らせを出して、結果欄を手で書けるようにする */
  const openManualEntry = (mode: ReportMode, message: string) => {
    if (mode === 'daily') rememberAiInfo(null);
    flushSync(() => apply({ type: 'openManualEntry', message }));
    saveSnapshot(mode);
    scrollTo(mode === 'daily' ? 'warnings' : 'accidentResult');
  };

  const generate = async () => {
    const f = formRef.current;
    if (!f.memo.trim()) {
      // 押したのに進まない理由のお知らせなので、赤色で消えずに残す
      showToast('今日の出来事メモを書いてください', true);
      return;
    }
    if (generatingRef.current !== null) return;
    const startedAt = Date.now();
    const requestNonce = nonceRef.current;
    const run: GenerationRun = { stopped: null, controller: null };
    generationRunRef.current = run;
    generatingRef.current = startedAt;
    setGeneratingSince(startedAt);
    setAiProgress(null);
    apply({ type: 'aiStarted' });
    // 出ているお知らせは消す(下の「⏹ 止めて手で書く」に重ならないように。新しい版の「更新する」つきは残す)
    const toastAction = toastStore.getState().action;
    if (!toastAction || toastAction === draftToastActionRef.current) hideToast();
    const finish = () => {
      if (generatingRef.current !== startedAt) return;
      generatingRef.current = null;
      if (generationRunRef.current === run) generationRunRef.current = null;
      setGeneratingSince(null);
      setAiProgress(null);
    };
    const stale = () => requestNonce !== nonceRef.current || run.stopped === 'reopened';

    /** 保育日報を1つのモデルで書く */
    const generateDaily = async (
      target: ReportCustomer,
      model: string | undefined,
      signal: AbortSignal,
    ): Promise<ModelGeneration> => {
      const { draft, ai } = await reportsApi.generateDaily(
        {
          text: f.memo,
          start: formatClock(f.start),
          end: formatClock(f.end),
          customerId: target.id,
          careRecipientId: dailyChildRef.current || null,
          riskRating: f.ratings.risk || null,
          reportDate: f.reportDate,
          ...(model ? { model } : {}),
        },
        signal,
      );
      if (isDailyDraftApiError(draft.warnings)) {
        return {
          ok: false,
          model: ai.model,
          reason: draft.internal || '不明なエラーが発生しました',
          retryable: ai.retryable,
        };
      }
      return {
        ok: true,
        model: ai.model,
        show: () => {
          const warnings = draft.warnings.length > 0 ? draft.warnings.join(', ') : null;
          if (warnings !== null) {
            // GAS版は結果欄を出す前に、足りない情報の知らせまでスクロールしていた。同じ位置で止まるよう、
            // 先に知らせだけを出して(すぐ描画して)スクロールしてから結果を入れる。
            flushSync(() => apply({ type: 'showWarnings', message: warnings }));
            warningsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
          // 足りない情報が無いときはスクロールしない(GAS版は結果欄を出す前に結果欄へのスクロールを
          // 呼んでいたため、実際には動いていなかった。同じ見え方にする)
          rememberAiInfo(ai);
          apply({
            type: 'dailyGenerated',
            internal: draft.internal,
            customer: appendStaffSurname(draft.customer, user.name),
            warnings,
          });
          saveSnapshot('daily');
        },
      };
    };

    /** 事故報告・ヒヤリハットを1つのモデルで書く */
    const generateAccident = async (
      model: string | undefined,
      signal: AbortSignal,
    ): Promise<ModelGeneration> => {
      const res = await reportsApi.generateAccident(
        { text: f.memo, start: formatClock(f.start), end: '', ...(model ? { model } : {}) },
        signal,
      );
      const { draft } = res;
      if ('error' in draft) {
        return { ok: false, model: res.model, reason: draft.error, retryable: res.retryable };
      }
      return {
        ok: true,
        model: res.model,
        show: () => {
          writeLastAccidentTime(draft.occurrenceTime || '');
          apply({
            type: 'accidentGenerated',
            draft: {
              occurrenceTime: draft.occurrenceTime || '',
              location: draft.location || '',
              accidentContent: draft.accidentContent || '',
              situation: draft.situation || '',
              immediateResponse: draft.immediateResponse || '',
              parentCorrespondence: draft.parentCorrespondence || '',
              diagnosisTreatment: draft.diagnosisTreatment || '',
              prevention: draft.prevention || '',
            },
          });
          scrollTo('accidentResult');
          saveSnapshot('accident');
        },
      };
    };

    try {
      const target = customerRef.current;
      if (f.mode === 'daily' && !target) {
        showToast('お客様の情報が見つかりません。画面を開きなおしてください', true);
        return;
      }
      const generateWith = (model: string | undefined, signal: AbortSignal) =>
        f.mode === 'daily' && target ? generateDaily(target, model, signal) : generateAccident(model, signal);
      // 試すモデルの順番(Flash 系 → Flash-Lite 系。日報・事故報告で同じ)。読めなければモデルを指定せずに1回だけ試す
      const listed = await runAttempt(run, (signal) => reportsApi.generateModels(signal));
      if (stale()) return;
      if (listed.kind === 'stopped') {
        flushSync(finish);
        openManualEntry(f.mode, STOPPED_MESSAGE);
        return;
      }
      const models: (string | undefined)[] =
        listed.kind === 'ok' && listed.value.models.length > 0 ? listed.value.models : [undefined];
      const tried: string[] = [];
      let lastReason = '';
      let notice: string | null = null;
      for (const [index, model] of models.entries()) {
        const label = model ?? '既定のモデル';
        setAiProgress({
          model: model ?? null,
          attempt: index + 1,
          total: models.length,
          failed: [...tried],
          notice,
        });
        const attempt = await runAttempt(run, (signal) => generateWith(model, signal));
        if (stale() || attempt.kind === 'reopened') return;
        if (attempt.kind === 'stopped') {
          flushSync(finish);
          openManualEntry(f.mode, STOPPED_MESSAGE);
          return;
        }
        if (attempt.kind === 'error') throw attempt.error;
        const next = models[index + 1];
        if (attempt.kind === 'timeout') {
          tried.push(label);
          lastReason = '時間がかかりすぎたため、問い合わせを切りました';
          if (next) notice = `${label} は時間がかかっているので、${next} で試しています`;
          continue;
        }
        const result = attempt.value;
        if (!result.ok) {
          tried.push(result.model ?? label);
          lastReason = result.reason;
          if (result.retryable && next) {
            notice = `${result.model ?? label} で書けなかったので、${next} で試しています`;
            continue;
          }
          break;
        }
        // GAS版と同じく、まずボタンを元に戻して(すぐ描画して)から結果を入れる
        // (結果へのスクロールの位置が、下のボタンの高さで変わるため)
        flushSync(finish);
        result.show();
        if (tried.length > 0) showToast(`${result.model ?? label} で書きました`);
        return;
      }
      flushSync(finish);
      openManualEntry(f.mode, failureMessage(tried, lastReason));
    } catch (e) {
      if (stale()) return;
      flushSync(finish);
      showErrorToast(e);
      // 上限・通信の失敗でも、手で書いて送れるようにする
      openManualEntry(f.mode, failureMessage([], userMessageOf(e)));
    } finally {
      finish();
    }
  };

  // ── 保存(GAS版 saveReport / executeSave) ──
  const executeSave = async (reportId: string | null) => {
    const target = customerRef.current;
    if (!target) {
      showToast('お客様の情報が見つかりません', true);
      return;
    }
    if (savingRef.current !== null) return;
    const f = formRef.current;
    const mode = f.mode;
    const startedAt = Date.now();
    const requestNonce = nonceRef.current;
    savingRef.current = startedAt;
    setSavingSince(startedAt);
    const finish = () => {
      if (savingRef.current !== startedAt) return;
      savingRef.current = null;
      setSavingSince(null);
    };
    const watchdog = setTimeout(() => {
      if (savingRef.current !== startedAt) return;
      finish();
      showToast('時間がかかっています。電波を確認して、もう一度押してください', true);
    }, WATCHDOG_MS);

    try {
      let message: string;
      let savedId: string;
      if (mode === 'daily') {
        const res = await reportsApi.saveDaily({
          reportId: reportId ?? undefined,
          customerId: target.id,
          reportDate: f.reportDate,
          startTime: formatClock(f.start),
          endTime: formatClock(f.end),
          inputText: f.memo,
          internalText: f.internalText,
          customerText: f.customerText,
          riskRating: f.ratings.risk || null,
          esRating: f.ratings.es || null,
          careRecipientId: dailyChildRef.current || null,
          aiGenerationId: aiInfoRef.current?.generationId ?? undefined,
        });
        message = res.report.psiAlert
          ? `${res.message || '保存しました'}（PSI ${res.report.riskRating}のため管理者に知らせました）`
          : res.message || '保存しました';
        savedId = res.report.id;
      } else {
        const a = f.accident;
        const res = await reportsApi.saveAccident({
          reportId: reportId ?? undefined,
          customerId: target.id,
          reportType: f.accidentType,
          targetName: a.targetName,
          targetDob: a.targetDob,
          occurrenceTime: a.occurrenceTime,
          location: a.location,
          accidentContent: a.accidentContent,
          situation: a.situation,
          immediateResponse: a.immediateResponse,
          parentCorrespondence: a.parentCorrespondence,
          diagnosisTreatment: a.diagnosisTreatment,
          prevention: a.prevention,
          inputText: f.memo,
        });
        message = `${f.accidentType}を保存しました`;
        savedId = res.report.id;
      }
      pushRecentCustomer(target.id, storageScope);
      showToast(message);
      // 待つ間にダイアログを開き直していたら(別のお客様かもしれない)、いまの入力の「保存しました」・
      // 上書き用の報告ID・書きかけの退避には触らない(次の保存が前のお客様の報告を上書きしないように)
      if (requestNonce !== nonceRef.current) return;
      apply({ type: 'saved', mode, reportId: savedId });
      // 保存できたので、書きかけの退避は要らない
      clearPendingDraft(storageScope);
    } catch (e) {
      showErrorToast(e);
    } finally {
      clearTimeout(watchdog);
      finish();
    }
  };

  const save = async () => {
    if (savingRef.current !== null) return;
    if (!customerRef.current) {
      showToast('お客様の情報が見つかりません。画面を開きなおしてください', true);
      return;
    }
    const reportId = formRef.current.saved[formRef.current.mode].reportId;
    if (reportId) {
      const ok = await confirm({ title: OVERWRITE_CONFIRM_TITLE, confirmLabel: '書きかえる' });
      if (!ok) return;
    }
    await executeSave(reportId);
  };

  // ── 訪問終わりました(GAS版 confirmVisitComplete / sendVisitComplete) ──
  const sendVisitComplete = async () => {
    if (!confirmNative('事務局に「訪問終わりました」を送りますか？')) return;
    const target = customerRef.current;
    if (!target) {
      showToast('お客様を選んでください', true);
      return;
    }
    const f = formRef.current;
    const requestNonce = nonceRef.current;
    setVisitComplete({ status: 'sending' });
    try {
      await reportsApi.visitComplete({
        customerId: target.id,
        visitDate: f.reportDate,
        startTime: formatClock(f.start),
        endTime: formatClock(f.end),
      });
      if (requestNonce === nonceRef.current) setVisitComplete({ status: 'sent', at: jstHHmm() });
      showToast('訪問終わりました、と事務局に知らせました');
    } catch (e) {
      if (requestNonce === nonceRef.current) setVisitComplete({ status: 'idle' });
      if (e instanceof ApiRequestError && !isUnauthenticated(e)) {
        showToast('お知らせを送れませんでした。電波を確認して、もう一度押してください', true);
      } else {
        showErrorToast(e);
      }
    }
  };

  // ── 領収書を送る ──
  /**
   * お客様の指定なしの領収書の既定の日時(送る時点)は、同じ写真を送り直す間は最初に送ろうとした時刻のまま使う
   * (通信の失敗のあと1分以上たって送り直しても、重複の判定のキーが変わらないように)。写真が全て送れて空になった・
   * 開き直したら決め直す。
   */
  const fallbackTimestampForSend = (f: { reportDate: string; start: ClockTime }): string => {
    if (session?.kind !== 'standalone') return receiptFallbackTimestamp(false, f);
    standaloneFallbackRef.current ??= receiptFallbackTimestamp(true, f);
    return standaloneFallbackRef.current;
  };
  const sendReceipts = () => {
    const f = formRef.current;
    const target = customerRef.current;
    if (target && f.mode !== 'daily') {
      showToast('領収書は「📝 今日の日報」から送ってください', true);
      return;
    }
    void receipts.send({
      staffName: user.name,
      customerId: target?.id ?? null,
      customerName: target ? target.name : unregisteredName.trim(),
      fallbackTimestamp: fallbackTimestampForSend(f),
    });
  };

  return {
    session,
    customer,
    form,
    uiConfig,
    actions,
    receipts,
    unregisteredName,
    generatingSince,
    aiProgress,
    stopGenerating: () => cancelAttempt('stopped'),
    savingSince,
    visitComplete,
    hint,
    hintOpen,
    closeHint: () => setHintOpen(false),
    openWritingHint,
    openAssessmentHint,
    generate: () => void generate(),
    save: () => void save(),
    sendVisitComplete: () => void sendVisitComplete(),
    sendReceipts,
    scrollRefs,
    today: currentToday,
    dailyAi: {
      childId: dailyChildId,
      selectChild: selectDailyChild,
      /** 家庭の★(未設定は null、読み込み中は undefined) */
      educationLevel: reportProfile.educationLevel,
      setEducationLevel: reportProfile.setEducationLevel,
      savingLevel: reportProfile.saving,
      info: aiInfo,
    },
  };
}

export type ReportController = ReturnType<typeof useReportController>;
