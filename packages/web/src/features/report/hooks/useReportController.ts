import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { ApiRequestError, isUnauthenticated } from '../../../api/client';
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
import { confirmNative, useConfirmModal } from '../../../ui/confirm';
import { showErrorToast, showToast } from '../../../ui/toast';
import { useSession } from '../../auth';
import { buildReceiptTimestamp, type ClockTime, formatClock, shiftReportDate } from '../model/dateTime';
import {
  applyDraftToForm,
  buildDraftSnapshot,
  clearPendingDraft,
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

/** AI生成・保存の見張り時間(これを過ぎても返事が無ければ、ボタンを押せる状態に戻して知らせる) */
const WATCHDOG_MS = 90_000;

export const OVERWRITE_CONFIRM_TITLE = '前に保存した日報を、今の内容に書きかえますか？';

export interface ReportCustomer {
  id: string;
  name: string;
  address: string;
  family: { name: string; dob: string }[];
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
  const writeLastAccidentTime = (value: string) =>
    writeStorage(userStorageKey(STORAGE_KEYS.lastAccidentTime, storageScope), value);
  const [generatingSince, setGeneratingSince] = useState<number | null>(null);
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
          family: (detail?.familyMembers ?? []).map((m) => ({ name: m.name, dob: m.dob ?? '' })),
        }
      : null;
  const customerRef = useRef(customer);
  useLayoutEffect(() => {
    customerRef.current = customer;
  });

  // ── 開くたびに初めの状態に戻す(GAS版 openModal / openStandaloneReceiptModal) ──
  // biome-ignore lint/correctness/useExhaustiveDependencies: 開き直したとき(nonce が変わったとき)だけ戻す
  useLayoutEffect(() => {
    if (!session) return;
    nonceRef.current = session.nonce;
    receipts.reset();
    setUnregisteredName('');
    if (session.kind === 'standalone') return; // GAS版は日報の入力には触らない(隠すだけ)
    generatingRef.current = null;
    savingRef.current = null;
    setGeneratingSince(null);
    setSavingSince(null);
    setVisitComplete({ status: 'idle' });
    let initial = createInitialForm({
      today: today(),
      lastStart: lastStartTime(storageScope),
      lastAccidentTime: readStorage(userStorageKey(STORAGE_KEYS.lastAccidentTime, storageScope)) || '',
    });
    // 保存していない入力が残っていれば、どのお客様を開いたときでもまず戻して見せる(GAS版と同じ)
    const draft = readPendingDraft(storageScope);
    if (draft) initial = applyDraftToForm(initial, draft);
    apply({ type: 'reset', state: initial });
    if (draft) showToast(draftRestoredMessage(draft), true);
  }, [nonce]);

  // 世帯構成員が読めたら、1人目を「対象のお子様」に選んでおく(GAS版 openModal の Auto Select first child)
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
  }, [session, detail, apply]);

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
    generatingRef.current = startedAt;
    setGeneratingSince(startedAt);
    const finish = () => {
      if (generatingRef.current !== startedAt) return;
      generatingRef.current = null;
      setGeneratingSince(null);
    };
    const watchdog = setTimeout(() => {
      if (generatingRef.current !== startedAt) return;
      finish();
      showToast('時間がかかっています。少し待ってから、もう一度押してください', true);
    }, WATCHDOG_MS);

    try {
      if (f.mode === 'daily') {
        const { draft } = await reportsApi.generateDaily({
          text: f.memo,
          start: formatClock(f.start),
          end: formatClock(f.end),
        });
        // GAS版と同じく、まずボタンを元に戻して(すぐ描画して)から結果を入れる
        // (結果へのスクロールの位置が、下のボタンの高さで変わるため)
        clearTimeout(watchdog);
        flushSync(finish);
        if (requestNonce !== nonceRef.current) return;
        if (isDailyDraftApiError(draft.warnings)) {
          apply({ type: 'showWarnings', message: draft.internal || '不明なエラーが発生しました' });
          saveSnapshot('daily');
          scrollTo('warnings');
          return;
        }
        const warnings = draft.warnings.length > 0 ? draft.warnings.join(', ') : null;
        if (warnings !== null) {
          // GAS版は結果欄を出す前に、足りない情報の知らせまでスクロールしていた。同じ位置で止まるよう、
          // 先に知らせだけを出して(すぐ描画して)スクロールしてから結果を入れる。
          flushSync(() => apply({ type: 'showWarnings', message: warnings }));
          warningsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        // 足りない情報が無いときはスクロールしない(GAS版は結果欄を出す前に結果欄へのスクロールを
        // 呼んでいたため、実際には動いていなかった。同じ見え方にする)
        apply({
          type: 'dailyGenerated',
          internal: draft.internal,
          customer: appendStaffSurname(draft.customer, user.name),
          warnings,
        });
        saveSnapshot('daily');
      } else {
        const { draft } = await reportsApi.generateAccident({
          text: f.memo,
          start: formatClock(f.start),
          end: '',
        });
        clearTimeout(watchdog);
        flushSync(finish);
        if (requestNonce !== nonceRef.current) return;
        if ('error' in draft) {
          saveSnapshot('accident');
          showToast(draft.error, true);
          return;
        }
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
      }
    } catch (e) {
      if (requestNonce === nonceRef.current) showErrorToast(e);
    } finally {
      clearTimeout(watchdog);
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
        });
        message = res.message || '保存しました';
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
      fallbackTimestamp: buildReceiptTimestamp(f.reportDate, f.start),
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
    today: today(),
  };
}

export type ReportController = ReturnType<typeof useReportController>;
