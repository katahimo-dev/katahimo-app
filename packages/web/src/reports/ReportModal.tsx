import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { ReceiptImageUpload } from '../api';
import {
  extractReceiptOcr,
  fetchCustomerDetail,
  generateAccidentReportDraft,
  generateDailyReportDraft,
  saveAccidentReport,
  saveDailyReport,
  sendVisitCompleteNotification,
  uploadReceipts,
} from '../api';
import { markCustomerRecentlyUsed } from '../recentCustomers';
import { ASSESSMENT_DEFINITIONS, type AssessmentType } from './assessmentDefinitions';
import {
  ACCIDENT_MEMO_PLACEHOLDER,
  ACCIDENT_WRITING_HINT,
  DAILY_MEMO_PLACEHOLDER,
  HIYARI_WRITING_HINT,
} from './promptDefaults';
import { useVoiceInput } from './useVoiceInput';

type Mode = 'daily' | 'accident';

/** GAS版index.htmlのpopulateHours()と同じ('00'〜'23')。 */
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
/** GAS版index.htmlのstartMinute/endMinuteの選択肢と同じ。 */
const MINUTES = ['00', '15', '30', '45'];
const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

/** GAS版updateDateDisplay()と同じ表示形式。 */
function formatDateDisplay(d: Date): string {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日(${WEEKDAY_LABELS[d.getDay()]})`;
}

/** 'YYYY-MM-DD'(タイムゾーンのずれを避けるためtoLocaleDateString('sv-SE')を使う。AttendanceTabと同じ手法)。 */
function formatDateKey(d: Date): string {
  return d.toLocaleDateString('sv-SE');
}

/**
 * PSI/従業員満足度(ES)の★評価。GAS版のupdateStarDisplay/setRatingと同じ挙動にしている:
 * - 選択中の★の色はtext-yellow-400、未選択はtext-gray-300。
 * - 星の右にASSESSMENT_DEFINITIONSから引いた評価ラベル(例: 「要観察」)を表示する
 *   (未評価時は空文字、GAS版のlabel-risk/label-esと同じ)。
 * - 左端(1番目)の★が既に選択済みの状態でもう一度押すと、全て☆(未評価=0)に戻せる
 *   (GAS版setRatingの`score === 1 && assessmentRatings[type] === 1`と同じ特別扱い。
 *   他の★を再度押しても解除はされない)。
 * - タイトル右の情報アイコンから、評価基準の一覧(AssessmentHintModal)を確認できる。
 */
function StarRating({
  type,
  value,
  onChange,
  onShowHint,
}: {
  type: AssessmentType;
  value: number | null;
  onChange: (v: number | null) => void;
  onShowHint: () => void;
}) {
  const definition = ASSESSMENT_DEFINITIONS[type];
  const currentLevel = definition.levels.find((l) => l.score === value);

  const handleClick = (n: number) => {
    if (n === 1 && value === 1) {
      onChange(null);
    } else {
      onChange(n);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-1 mb-1">
        <span className="text-xs font-bold text-gray-600">{definition.title}</span>
        <button
          type="button"
          onClick={onShowHint}
          className="text-gray-400 hover:text-blue-500"
          title={`${definition.title}の評価基準を見る`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </button>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex gap-0.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => handleClick(n)}
              className={`text-2xl transition-transform hover:scale-110 focus:outline-none ${
                value !== null && n <= value ? 'text-yellow-400' : 'text-gray-300'
              }`}
            >
              ★
            </button>
          ))}
        </div>
        <span className="text-xs font-bold text-gray-600">{currentLevel?.label ?? ''}</span>
      </div>
    </div>
  );
}

/** GAS版showAssessmentHintと同じ、評価基準一覧のモーダル。 */
function AssessmentHintModal({ type, onClose }: { type: AssessmentType; onClose: () => void }) {
  const definition = ASSESSMENT_DEFINITIONS[type];
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-[130] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-xl shadow-xl flex flex-col max-h-[85vh]">
        <div className="p-4 border-b flex justify-between items-center bg-gray-50 rounded-t-xl">
          <h3 className="font-bold text-gray-800 text-sm">{definition.title} 指標</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-2 hover:bg-gray-200 rounded-full text-gray-500"
          >
            &times;
          </button>
        </div>
        <div className="p-4 overflow-y-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="p-2 text-xs w-10">評価</th>
                <th className="p-2 text-xs w-20">定義</th>
                <th className="p-2 text-xs">判断基準</th>
              </tr>
            </thead>
            <tbody>
              {definition.levels.map((l) => (
                <tr key={l.score} className="border-b">
                  <td className="p-2 text-lg font-bold text-center text-yellow-500">{l.score}</td>
                  <td className="p-2 text-sm font-bold">{l.label}</td>
                  <td className="p-2 text-xs text-gray-600 whitespace-pre-wrap">{l.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/**
 * 事故報告/ヒヤリハットの「💡書き方のヒント」モーダル。GAS版toggleHintと同じく、
 * 種別(reportType)がヒヤリハットの場合はHIYARI_WRITING_HINT、それ以外はACCIDENT_WRITING_HINT
 * を表示する(タイトルも切り替える)。
 */
function WritingHintModal({
  reportType,
  onClose,
}: {
  reportType: '事故報告' | 'ヒヤリハット';
  onClose: () => void;
}) {
  const isHiyari = reportType === 'ヒヤリハット';
  const title = isHiyari ? 'ヒヤリハットの書き方ヒント' : '事故報告書の書き方ヒント';
  const content = isHiyari ? HIYARI_WRITING_HINT : ACCIDENT_WRITING_HINT;
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-[130] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-xl shadow-xl flex flex-col max-h-[85vh]">
        <div className="p-4 border-b flex justify-between items-center bg-gray-50 rounded-t-xl">
          <h3 className="font-bold text-gray-800 text-sm">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-2 hover:bg-gray-200 rounded-full text-gray-500"
          >
            &times;
          </button>
        </div>
        <div className="p-4 overflow-y-auto text-sm text-gray-700 whitespace-pre-wrap">{content}</div>
      </div>
    </div>
  );
}

/** GAS版index.htmlのcalculateAge()と同じ「(N歳Mか月)」表示。dobは'YYYY-MM-DD'想定。 */
function calculateAgeLabel(dob: string | null): string {
  if (!dob) return '';
  const parts = dob.split(/[-/]/).map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return '';
  const [y, m, d] = parts as [number, number, number];
  const birth = new Date(y, m - 1, d);
  const today = new Date();
  let years = today.getFullYear() - birth.getFullYear();
  let months = today.getMonth() - birth.getMonth();
  if (today.getDate() < birth.getDate()) months--;
  if (months < 0) {
    years--;
    months += 12;
  }
  return `(${years}歳${months}か月)`;
}

interface ReceiptImageState {
  id: string;
  dataUrl: string;
  amount: string;
  storeName: string;
  receiptDate: string;
  ocrLoading: boolean;
  /** OCR失敗時のエラーメッセージ(表示用)。成功時・未実行時はnull。 */
  ocrError: string | null;
}

/**
 * AI生成・OCRのエラーコード('API Error'/'API Key Missing'。GAS版GeminiReport.jsの
 * generateReportWithWarnings/generateAccidentReport/extractAmountFromImageが返す値と同じ)を、
 * スタッフ向けの分かりやすい文言に変換する。GAS版はこれらをそのまま(あるいは無言で)表示していて
 * 不親切だったため、katahimo-app側で追加した変換。
 */
function friendlyAiErrorMessage(raw: string): string {
  if (raw === 'API Key Missing') {
    return 'AIによる自動生成が設定されていません。管理者にGemini APIキーの設定をご確認ください。';
  }
  if (raw === 'API Error') {
    return 'AIによる生成でエラーが発生しました。しばらく待ってから再度お試しください。';
  }
  return raw;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** GAS版resizeAndAddImageのMAX_WIDTH/MAX_HEIGHT・JPEG品質と同じ値。 */
const RECEIPT_IMAGE_MAX_DIMENSION = 1200;
const RECEIPT_IMAGE_JPEG_QUALITY = 0.7;

/** 長辺1200px以内・JPEG品質0.7へリサイズ/圧縮する。GAS版resizeAndAddImageと同じロジック。 */
function resizeReceiptImage(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let { width, height } = img;
      if (width > height) {
        if (width > RECEIPT_IMAGE_MAX_DIMENSION) {
          height *= RECEIPT_IMAGE_MAX_DIMENSION / width;
          width = RECEIPT_IMAGE_MAX_DIMENSION;
        }
      } else if (height > RECEIPT_IMAGE_MAX_DIMENSION) {
        width *= RECEIPT_IMAGE_MAX_DIMENSION / height;
        height = RECEIPT_IMAGE_MAX_DIMENSION;
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas 2D contextの取得に失敗しました'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', RECEIPT_IMAGE_JPEG_QUALITY));
    };
    img.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
    img.src = dataUrl;
  });
}

/** 'yyyy/MM/dd HH:mm'形式で現在時刻を返す(OCRが日時を読み取れなかった場合のフォールバック)。GAS版getNowDatetimeLocalと同じ役割。 */
function formatNowForReceipt(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 顧客カードタップで開く報告作成モーダル。GAS版index.htmlのreportModal(保育日報/事故報告の
 * 2タブ+領収書登録)に対応。「顧客情報」「活動記録」は別モーダル(CustomerDetail/HistoryModal)
 * に分かれている点もGAS版と同じ(openModal(customer)は常にこの報告モーダルを開く)。
 */
export function ReportModal({ customerId, onClose }: { customerId: string; onClose: () => void }) {
  const customerQuery = useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => fetchCustomerDetail(customerId),
  });

  const [mode, setMode] = useState<Mode>('daily');
  const [selectedFamilyId, setSelectedFamilyId] = useState('');

  // ── 日付・時間(保育日報/事故報告で共有。GAS版のmodalDateSection/modalTimeSectionと同じ) ──
  const [visitDate, setVisitDate] = useState(() => new Date());
  const [startHour, setStartHour] = useState(() => localStorage.getItem('last_start_hour') || '09');
  const [startMinute, setStartMinute] = useState(() => localStorage.getItem('last_start_minute') || '00');
  const [endHour, setEndHour] = useState('11');
  const [endMinute, setEndMinute] = useState('00');
  const [sendingVisitComplete, setSendingVisitComplete] = useState(false);
  const [visitCompleteMessage, setVisitCompleteMessage] = useState<string | null>(null);

  /** GAS版changeDate()と同じ。未来日への変更は禁止する。 */
  const changeDate = (offsetDays: number) => {
    setVisitDate((prev) => {
      const next = new Date(prev);
      next.setDate(next.getDate() + offsetDays);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const check = new Date(next);
      check.setHours(0, 0, 0, 0);
      if (offsetDays > 0 && check > today) return prev;
      return next;
    });
  };
  const isNextDateDisabled = (() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(visitDate);
    target.setHours(0, 0, 0, 0);
    return target >= today;
  })();

  /** GAS版autoSetEndTime()と同じ(開始+2時間、分は開始と同じ)。 */
  const handleStartHourChange = (value: string) => {
    setStartHour(value);
    localStorage.setItem('last_start_hour', value);
    setEndHour(String((Number.parseInt(value, 10) + 2) % 24).padStart(2, '0'));
  };
  const handleStartMinuteChange = (value: string) => {
    setStartMinute(value);
    localStorage.setItem('last_start_minute', value);
    setEndMinute(value);
  };

  const handleVisitComplete = async () => {
    setSendingVisitComplete(true);
    setVisitCompleteMessage(null);
    try {
      await sendVisitCompleteNotification(
        customerId,
        formatDateKey(visitDate),
        `${startHour}:${startMinute}`,
        `${endHour}:${endMinute}`,
      );
      setVisitCompleteMessage('訪問完了の通知を送信しました');
    } catch (e) {
      setVisitCompleteMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setSendingVisitComplete(false);
    }
  };

  // ── 保育日報 ──
  const [riskRating, setRiskRating] = useState<number | null>(null);
  const [esRating, setEsRating] = useState<number | null>(null);
  const [hintType, setHintType] = useState<AssessmentType | null>(null);
  const [showWritingHint, setShowWritingHint] = useState(false);
  const [memoText, setMemoText] = useState('');
  const [internalText, setInternalText] = useState('');
  const [customerText, setCustomerText] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [generatingDaily, setGeneratingDaily] = useState(false);
  const [savingDaily, setSavingDaily] = useState(false);
  const [dailyMessage, setDailyMessage] = useState<string | null>(null);
  const [dailyError, setDailyError] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  /**
   * 保存済み日報のID+保存時点の内容スナップショット(JSON文字列)。GAS版のsavedReportsState/
   * rowIndexに相当し、「保存する」を複数回押しても同じ内容の行を重複作成しないための仕組み。
   * - 未保存(null): 保存時はDBに新規作成し、IDとスナップショットを記録する。
   * - 保存済みで内容が前回と同一: 保存をスキップする(重複行の原因だったため)。
   * - 保存済みで内容が変わっている: 上書き確認のうえ、IDを指定してDB側で更新(アップサート)する。
   */
  const [dailySavedId, setDailySavedId] = useState<string | null>(null);
  const [dailySavedSnapshot, setDailySavedSnapshot] = useState<string | null>(null);

  /** GAS版copyToClipboard('customerResult')と同じ役割。 */
  const handleCopyCustomerText = async () => {
    try {
      await navigator.clipboard.writeText(customerText);
      setCopyMessage('コピーしました');
    } catch {
      setCopyMessage('コピーに失敗しました');
    }
  };
  const dailyVoice = useVoiceInput((text) => setMemoText((prev) => (prev ? `${prev}\n${text}` : text)));

  // ── 事故報告/ヒヤリハット ──
  const [reportType, setReportType] = useState<'事故報告' | 'ヒヤリハット'>('事故報告');
  const [accidentMemo, setAccidentMemo] = useState('');
  const accidentVoice = useVoiceInput((text) =>
    setAccidentMemo((prev) => (prev ? `${prev}\n${text}` : text)),
  );
  const [accTargetName, setAccTargetName] = useState('');
  const [accTargetDob, setAccTargetDob] = useState('');
  const [occurrenceTime, setOccurrenceTime] = useState('');
  const [location, setLocation] = useState('');
  const [accidentContent, setAccidentContent] = useState('');
  const [situation, setSituation] = useState('');
  const [immediateResponse, setImmediateResponse] = useState('');
  const [parentCorrespondence, setParentCorrespondence] = useState('');
  const [diagnosisTreatment, setDiagnosisTreatment] = useState('');
  const [prevention, setPrevention] = useState('');
  const [generatingAccident, setGeneratingAccident] = useState(false);
  const [savingAccident, setSavingAccident] = useState(false);
  const [accidentMessage, setAccidentMessage] = useState<string | null>(null);
  const [accidentError, setAccidentError] = useState<string | null>(null);
  /** 保存済み事故報告のID+保存時点の内容スナップショット。dailySavedId/dailySavedSnapshotと同じ役割。 */
  const [accidentSavedId, setAccidentSavedId] = useState<string | null>(null);
  const [accidentSavedSnapshot, setAccidentSavedSnapshot] = useState<string | null>(null);

  // ── 領収書登録(日報タブのみ。GAS版と同じ制約) ──
  const [images, setImages] = useState<ReceiptImageState[]>([]);
  const [handoffText, setHandoffText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  /** 対象者選択(GAS版onFamilySelect()と同じ、事故報告の対象者氏名/生年月日を自動入力する)。 */
  const handleFamilySelect = (id: string) => {
    setSelectedFamilyId(id);
    const fam = customerQuery.data?.familyMembers.find((f) => f.id === id);
    setAccTargetName(fam?.name ?? '');
    setAccTargetDob(fam?.dob ?? '');
  };

  const handleGenerateDaily = async () => {
    if (!memoText.trim()) return;
    setGeneratingDaily(true);
    setDailyError(null);
    try {
      const draft = await generateDailyReportDraft(
        memoText,
        `${startHour}:${startMinute}`,
        `${endHour}:${endMinute}`,
      );
      // GAS版onReportGeneratedのisApiErrorチェックと同じ。'API Error'/'API Key Missing'は
      // 「不足項目」ではなく生成そのものの失敗なので、結果欄には反映せず分かりやすいエラーとして表示する
      // (GAS版はresult.internalの生エラー文言をそのまま画面に出しており不親切だった)。
      const failureCode = draft.warnings.find((w) => w === 'API Error' || w === 'API Key Missing');
      if (failureCode) {
        setWarnings([]);
        setDailyError(friendlyAiErrorMessage(failureCode));
        return;
      }
      setWarnings(draft.warnings);
      setInternalText(draft.internal);
      setCustomerText(draft.customer);
    } catch (e) {
      setDailyError(e instanceof Error ? e.message : String(e));
    } finally {
      setGeneratingDaily(false);
    }
  };

  const handleSaveDaily = async () => {
    if (!customerQuery.data) return;
    const payload = {
      customerId,
      reportDate: formatDateKey(visitDate),
      startTime: `${startHour}:${startMinute}`,
      endTime: `${endHour}:${endMinute}`,
      inputText: memoText,
      internalText,
      customerText,
      riskRating,
      esRating,
    };
    const snapshot = JSON.stringify(payload);
    // GAS版savedReportsState/rowIndexと同じ考え方: 既に保存済みで内容が変わっていなければ
    // 再度保存ボタンを押しても何もしない(これが「複数回押すと同じ内容が重複登録される」原因だった)。
    if (dailySavedId && snapshot === dailySavedSnapshot) {
      setDailyMessage('内容に変更がないため、保存をスキップしました');
      return;
    }
    if (dailySavedId) {
      const confirmed = window.confirm('この日報は保存済みです。内容を上書き保存しますか?');
      if (!confirmed) return;
    }
    setSavingDaily(true);
    setDailyMessage(null);
    setDailyError(null);
    try {
      const report = await saveDailyReport({ ...payload, reportId: dailySavedId ?? undefined });
      setDailySavedId(report.id);
      setDailySavedSnapshot(snapshot);
      setDailyMessage('日報を保存しました');
      markCustomerRecentlyUsed(customerId);
    } catch (e) {
      setDailyError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingDaily(false);
    }
  };

  const handleGenerateAccident = async () => {
    if (!accidentMemo.trim()) return;
    setGeneratingAccident(true);
    setAccidentError(null);
    try {
      const draft = await generateAccidentReportDraft(accidentMemo, `${startHour}:${startMinute}`);
      if ('error' in draft) {
        setAccidentError(friendlyAiErrorMessage(draft.error));
        return;
      }
      setOccurrenceTime(draft.occurrenceTime);
      setLocation(draft.location);
      setAccidentContent(draft.accidentContent);
      setSituation(draft.situation);
      setImmediateResponse(draft.immediateResponse);
      setParentCorrespondence(draft.parentCorrespondence);
      setDiagnosisTreatment(draft.diagnosisTreatment);
      setPrevention(draft.prevention);
    } catch (e) {
      setAccidentError(e instanceof Error ? e.message : String(e));
    } finally {
      setGeneratingAccident(false);
    }
  };

  const handleSaveAccident = async () => {
    const payload = {
      customerId,
      reportType,
      targetName: accTargetName,
      targetDob: accTargetDob,
      occurrenceTime,
      location,
      accidentContent,
      situation,
      immediateResponse,
      parentCorrespondence,
      diagnosisTreatment,
      prevention,
      inputText: accidentMemo,
    };
    const snapshot = JSON.stringify(payload);
    if (accidentSavedId && snapshot === accidentSavedSnapshot) {
      setAccidentMessage('内容に変更がないため、保存をスキップしました');
      return;
    }
    if (accidentSavedId) {
      const confirmed = window.confirm(`この${reportType}は保存済みです。内容を上書き保存しますか?`);
      if (!confirmed) return;
    }
    setSavingAccident(true);
    setAccidentMessage(null);
    setAccidentError(null);
    try {
      const report = await saveAccidentReport({ ...payload, reportId: accidentSavedId ?? undefined });
      setAccidentSavedId(report.id);
      setAccidentSavedSnapshot(snapshot);
      setAccidentMessage(`${reportType}を保存しました`);
      markCustomerRecentlyUsed(customerId);
    } catch (e) {
      setAccidentError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingAccident(false);
    }
  };

  const MAX_RECEIPT_IMAGES = 6;

  /**
   * 画像1枚をリサイズ/圧縮してプレビューに追加し、そのままOCRを自動実行する。
   * GAS版resizeAndAddImage→runOcrと同じ流れ(手動の「OCRで自動入力」ボタンは無く、
   * 追加した瞬間に自動でOCRが走る)。複数枚を同時に追加した場合、各画像は互いを待たず
   * 独立に処理される(GAS版がFileReader+resizeAndAddImageをファイルごとに並行して
   * 呼んでいるのと同じ)。
   */
  const addAndOcrReceiptImage = async (file: File) => {
    const id = crypto.randomUUID();
    let dataUrl: string;
    try {
      dataUrl = await resizeReceiptImage(await readFileAsDataUrl(file));
    } catch (e) {
      setUploadMessage(e instanceof Error ? e.message : String(e));
      return;
    }
    setImages((prev) => [
      ...prev,
      { id, dataUrl, amount: '', storeName: '', receiptDate: '', ocrLoading: true, ocrError: null },
    ]);

    try {
      const result = await extractReceiptOcr(dataUrl);
      // GAS版extractAmountFromImageは失敗時も空値を返すのみで無言だったため、
      // 金額等が空のまま何のエラーも表示されない不親切な挙動になっていた。ここでは
      // result.errorを表示し、手入力が必要なことに気付けるようにする。
      setImages((prev) =>
        prev.map((img) =>
          img.id === id
            ? {
                ...img,
                amount: result.amount ? String(result.amount) : img.amount,
                storeName: result.storeName || img.storeName,
                receiptDate: result.receiptDate || formatNowForReceipt(),
                ocrLoading: false,
                ocrError: result.error ? friendlyAiErrorMessage(result.error) : null,
              }
            : img,
        ),
      );
    } catch (e) {
      setImages((prev) =>
        prev.map((img) =>
          img.id === id
            ? {
                ...img,
                receiptDate: img.receiptDate || formatNowForReceipt(),
                ocrLoading: false,
                ocrError: e instanceof Error ? e.message : String(e),
              }
            : img,
        ),
      );
    }
  };

  const handleAddImages = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setDuplicateWarning(null);
    const files = Array.from(fileList);
    if (images.length + files.length > MAX_RECEIPT_IMAGES) {
      setUploadMessage(`画像は最大${MAX_RECEIPT_IMAGES}枚までです`);
      return;
    }
    for (const file of files) {
      void addAndOcrReceiptImage(file);
    }
  };

  const handleUploadReceipts = async () => {
    if (images.length === 0) return;
    setUploading(true);
    setUploadMessage(null);
    setDuplicateWarning(null);
    try {
      const payloadImages: ReceiptImageUpload[] = images.map((img) => ({
        data: img.dataUrl,
        amount: img.amount || null,
        storeName: img.storeName || null,
        receiptDate: img.receiptDate || null,
      }));
      const result = await uploadReceipts({ customerId, images: payloadImages, handoffText });
      markCustomerRecentlyUsed(customerId);
      const duplicateIndexes = new Set(result.duplicates.map((d) => d.index));
      setImages((prev) => prev.filter((_, idx) => duplicateIndexes.has(idx)));
      if (duplicateIndexes.size === 0) setHandoffText('');

      // GAS版showReceiptDuplicateWarningと同じ、重複でスキップされた領収書の一覧表示。
      if (result.duplicates.length > 0) {
        const customerName = customerQuery.data?.name ?? '';
        const lines = result.duplicates.map(
          (d, idx) =>
            `${idx + 1}. ${d.timestamp} / 顧客名:${customerName} / 金額:${d.amount} / 名称:${d.storeName}`,
        );
        setDuplicateWarning(`⚠️ 既存の領収書と重複したため登録しませんでした。\n${lines.join('\n')}`);
      } else {
        setUploadMessage(result.message);
      }
    } catch (e) {
      setUploadMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-end sm:items-center justify-center">
      <div className="bg-white w-full max-w-md h-[92vh] sm:h-auto sm:max-h-[90vh] sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col">
        <div className="p-4 border-b flex justify-between items-center bg-gray-50 rounded-t-2xl shrink-0">
          <div>
            <h2 className="font-bold text-lg text-gray-800">{customerQuery.data?.name ?? '読み込み中…'}</h2>
            {customerQuery.data?.city && <p className="text-xs text-gray-500">{customerQuery.data.city}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 hover:bg-gray-200 rounded-full text-gray-500 text-xl leading-none"
          >
            &times;
          </button>
        </div>

        <div className="flex border-b shrink-0">
          <button
            type="button"
            onClick={() => setMode('daily')}
            className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
              mode === 'daily' ? 'text-blue-600 border-blue-600' : 'text-gray-500 border-transparent'
            }`}
          >
            📝 保育日報
          </button>
          <button
            type="button"
            onClick={() => setMode('accident')}
            className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
              mode === 'accident' ? 'text-blue-600 border-blue-600' : 'text-gray-500 border-transparent'
            }`}
          >
            ⚠️ 事故報告
          </button>
        </div>

        <div className="flex-grow overflow-y-auto p-4 space-y-4">
          {customerQuery.isPending && (
            <div className="flex justify-center py-8">
              <div className="w-8 h-8 rounded-full border-4 border-gray-200 loading-spinner" />
            </div>
          )}

          {/* GAS版familySelectorContainerと同じく、事故報告タブでのみ表示する
              (対象者氏名/生年月日の自動入力に使うため。日報タブでは非表示)。 */}
          {mode === 'accident' && customerQuery.data && customerQuery.data.familyMembers.length > 0 && (
            <div>
              <label htmlFor="familySelector" className="text-xs text-gray-500 block mb-1">
                対象者(ご家族)
              </label>
              <select
                id="familySelector"
                value={selectedFamilyId}
                onChange={(e) => handleFamilySelect(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm bg-gray-50"
              >
                <option value="">(選択してください)</option>
                {customerQuery.data.familyMembers.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} {calculateAgeLabel(f.dob)}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* 日付(保育日報/事故報告で共有)。GAS版modalDateSectionと同じ。 */}
          <div className="flex items-center justify-between bg-gray-50 p-2 rounded-lg border border-gray-300">
            <button
              type="button"
              onClick={() => changeDate(-1)}
              className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-colors"
            >
              ‹
            </button>
            <div className="text-base font-bold text-gray-800">{formatDateDisplay(visitDate)}</div>
            <button
              type="button"
              onClick={() => changeDate(1)}
              disabled={isNextDateDisabled}
              className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              ›
            </button>
          </div>

          {/* 時間(保育日報/事故報告で共有)。GAS版modalTimeSectionと同じ(hour/minuteセレクト)。 */}
          <div className="space-y-4">
            <div>
              <label htmlFor="startHour" className="text-xs text-gray-500 block mb-1">
                開始時間/発生時間
              </label>
              <div className="flex items-center gap-2">
                <select
                  id="startHour"
                  value={startHour}
                  onChange={(e) => handleStartHourChange(e.target.value)}
                  className="flex-1 border rounded-lg p-2 text-sm bg-gray-50"
                >
                  {HOURS.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
                <span className="text-gray-400">:</span>
                <select
                  value={startMinute}
                  onChange={(e) => handleStartMinuteChange(e.target.value)}
                  className="flex-1 border rounded-lg p-2 text-sm bg-gray-50"
                >
                  {MINUTES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {mode === 'daily' && (
              <div>
                <label htmlFor="endHour" className="text-xs text-gray-500 block mb-1">
                  終了時間
                </label>
                <div className="flex items-center gap-2">
                  <select
                    id="endHour"
                    value={endHour}
                    onChange={(e) => setEndHour(e.target.value)}
                    className="flex-1 border rounded-lg p-2 text-sm bg-gray-50"
                  >
                    {HOURS.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                  <span className="text-gray-400">:</span>
                  <select
                    value={endMinute}
                    onChange={(e) => setEndMinute(e.target.value)}
                    className="flex-1 border rounded-lg p-2 text-sm bg-gray-50"
                  >
                    {MINUTES.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <div className="text-right">
              <button
                type="button"
                onClick={handleVisitComplete}
                disabled={sendingVisitComplete}
                className="text-xs bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white px-3 py-1.5 rounded-md font-bold transition-colors"
              >
                {sendingVisitComplete ? '送信中...' : '訪問完了'}
              </button>
              {visitCompleteMessage && <p className="text-xs text-gray-500 mt-1">{visitCompleteMessage}</p>}
            </div>
          </div>

          {/* 領収書登録(日報タブのみ)。GAS版imageUploadSectionと同じ位置(訪問完了ボタンの直後)・
              構成(見出し行の右に「領収書登録」ボタン、サムネイル+カメラ撮影/アルバムボタンを
              横並びのflex-wrapで並べる)にしている。 */}
          {mode === 'daily' && (
            <div className="border-t pt-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-500">領収書 (最大6枚)</span>
                <button
                  type="button"
                  onClick={handleUploadReceipts}
                  disabled={uploading || images.length === 0}
                  className="text-xs bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white px-3 py-1.5 rounded-md font-bold transition-colors"
                >
                  {uploading ? 'アップロード中…' : '領収書登録'}
                </button>
              </div>

              {duplicateWarning && (
                <div className="mb-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-800 whitespace-pre-wrap">
                  {duplicateWarning}
                </div>
              )}

              <div className="flex flex-wrap gap-2 items-start">
                {images.map((img) => (
                  <div key={img.id} className="relative w-40 flex flex-col gap-1 items-center">
                    <div className="relative w-24 h-24 rounded-xl overflow-hidden shadow-sm border border-gray-200 bg-gray-100">
                      <img src={img.dataUrl} alt="領収書" className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setImages((prev) => prev.filter((i) => i.id !== img.id))}
                        className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-80 hover:opacity-100 shadow-md"
                      >
                        &times;
                      </button>
                      {img.ocrLoading && (
                        <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                          <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full loading-spinner" />
                        </div>
                      )}
                    </div>
                    <input
                      type="text"
                      value={img.receiptDate}
                      onChange={(e) =>
                        setImages((prev) =>
                          prev.map((i) => (i.id === img.id ? { ...i, receiptDate: e.target.value } : i)),
                        )
                      }
                      placeholder="日時(yyyy/MM/dd HH:mm)"
                      className="w-full p-1 text-[11px] border border-blue-300 rounded text-center bg-blue-50 font-medium"
                    />
                    <input
                      type="text"
                      value={img.amount}
                      onChange={(e) =>
                        setImages((prev) =>
                          prev.map((i) => (i.id === img.id ? { ...i, amount: e.target.value } : i)),
                        )
                      }
                      placeholder="金額"
                      className="w-full p-1 text-sm border border-gray-300 rounded text-center"
                    />
                    <input
                      type="text"
                      value={img.storeName}
                      onChange={(e) =>
                        setImages((prev) =>
                          prev.map((i) => (i.id === img.id ? { ...i, storeName: e.target.value } : i)),
                        )
                      }
                      placeholder="店舗名"
                      className="w-full p-1 text-sm border border-gray-300 rounded text-center"
                    />
                    {img.ocrError && (
                      <p className="text-[10px] text-red-500 text-center leading-tight">
                        自動読取に失敗しました。金額等を手入力してください。
                      </p>
                    )}
                  </div>
                ))}

                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="w-20 h-20 border-2 border-dashed border-blue-300 rounded-xl flex flex-col items-center justify-center text-blue-500 hover:bg-blue-50 transition-colors bg-white"
                >
                  <svg
                    className="w-8 h-8 mb-1"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                  <span className="text-[10px] font-bold">カメラ撮影</span>
                </button>
                <button
                  type="button"
                  onClick={() => galleryInputRef.current?.click()}
                  className="w-20 h-20 border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center text-gray-400 hover:text-gray-600 hover:border-gray-400 transition-colors bg-gray-50"
                >
                  <svg
                    className="w-8 h-8 mb-1"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                    />
                  </svg>
                  <span className="text-[10px] font-bold">アルバム</span>
                </button>
              </div>

              {/* カメラは1枚ずつ即撮影(capture属性でスマホのカメラアプリを直接起動)、アルバムは複数選択可。GAS版index.htmlのcameraInput/galleryInputと同じ使い分け。 */}
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => {
                  handleAddImages(e.target.files);
                  e.target.value = '';
                }}
                className="hidden"
              />
              <input
                ref={galleryInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => {
                  handleAddImages(e.target.files);
                  e.target.value = '';
                }}
                className="hidden"
              />

              <div className="mt-3">
                <textarea
                  value={handoffText}
                  onChange={(e) => setHandoffText(e.target.value)}
                  rows={2}
                  placeholder="領収書に関する申し送り事項があれば入力"
                  className="w-full border rounded-lg px-3 py-2 text-sm bg-gray-50"
                />
              </div>
              {uploadMessage && <p className="text-sm text-gray-700 mt-1">{uploadMessage}</p>}
            </div>
          )}

          {mode === 'daily' && (
            <div className="space-y-4">
              <div className="space-y-1">
                <StarRating
                  type="risk"
                  value={riskRating}
                  onChange={setRiskRating}
                  onShowHint={() => setHintType('risk')}
                />
                <StarRating
                  type="es"
                  value={esRating}
                  onChange={setEsRating}
                  onShowHint={() => setHintType('es')}
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label htmlFor="memoText" className="text-xs text-gray-500">
                    訪問メモ(口語でOK・音声入力可)
                  </label>
                  <button
                    type="button"
                    onClick={dailyVoice.toggle}
                    className={`text-xs px-2 py-1 rounded-md flex items-center gap-1 transition-colors ${
                      dailyVoice.listening
                        ? 'bg-red-100 text-red-700'
                        : 'bg-gray-100 hover:bg-gray-200 text-gray-600'
                    }`}
                  >
                    {dailyVoice.listening ? (
                      <>
                        <span className="animate-pulse">🔴</span> <span>停止する</span>
                      </>
                    ) : (
                      <>
                        <span>🎤</span> <span>音声入力</span>
                      </>
                    )}
                  </button>
                </div>
                <textarea
                  id="memoText"
                  value={memoText}
                  onChange={(e) => setMemoText(e.target.value)}
                  rows={4}
                  placeholder={DAILY_MEMO_PLACEHOLDER}
                  className="w-full border rounded-lg px-3 py-2 text-sm bg-gray-50"
                />
                {dailyVoice.error && <p className="text-red-500 text-xs mt-1">{dailyVoice.error}</p>}
              </div>

              <button
                type="button"
                onClick={handleGenerateDaily}
                disabled={generatingDaily || !memoText.trim()}
                className="w-full py-2.5 bg-blue-50 hover:bg-blue-100 disabled:opacity-60 text-blue-700 font-bold rounded-lg text-sm"
              >
                {generatingDaily ? 'AI生成中…' : '✨ AIでレポート生成'}
              </button>

              {warnings.length > 0 && (
                <p className="text-xs text-orange-600 bg-orange-50 border border-orange-200 rounded-lg p-2">
                  不足している可能性がある項目: {warnings.join('、')}
                </p>
              )}

              <div>
                <label htmlFor="internalText" className="text-xs text-gray-500 block mb-1">
                  社内向けレポート
                  <span className="text-gray-400 font-normal ml-2">{internalText.length}文字</span>
                </label>
                <textarea
                  id="internalText"
                  value={internalText}
                  onChange={(e) => setInternalText(e.target.value)}
                  rows={4}
                  className="w-full border rounded-lg px-3 py-2 text-sm bg-gray-50"
                />
              </div>
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label htmlFor="customerText" className="text-xs text-gray-500">
                    保護者向けレポート
                    <span className="text-gray-400 font-normal ml-2">{customerText.length}文字</span>
                  </label>
                  <button
                    type="button"
                    onClick={handleCopyCustomerText}
                    className="text-xs bg-green-100 hover:bg-green-200 text-green-700 px-2 py-1 rounded"
                  >
                    📋 コピー
                  </button>
                </div>
                <textarea
                  id="customerText"
                  value={customerText}
                  onChange={(e) => setCustomerText(e.target.value)}
                  rows={4}
                  className="w-full border rounded-lg px-3 py-2 text-sm bg-gray-50"
                />
              </div>

              {copyMessage && <p className="text-gray-500 text-xs">{copyMessage}</p>}
              {dailyError && <p className="text-red-500 text-sm">{dailyError}</p>}
              {dailyMessage && <p className="text-green-600 text-sm">{dailyMessage}</p>}

              <button
                type="button"
                onClick={handleSaveDaily}
                disabled={savingDaily}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold rounded-xl"
              >
                {savingDaily ? '保存中…' : '日報を保存'}
              </button>
            </div>
          )}

          {mode === 'accident' && (
            <div className="space-y-4">
              <div>
                <label htmlFor="reportType" className="text-xs text-gray-500 block mb-1">
                  種別
                </label>
                <select
                  id="reportType"
                  value={reportType}
                  onChange={(e) => setReportType(e.target.value as '事故報告' | 'ヒヤリハット')}
                  className="w-full border rounded-lg px-3 py-2 text-sm bg-gray-50"
                >
                  <option value="事故報告">事故報告</option>
                  <option value="ヒヤリハット">ヒヤリハット</option>
                </select>
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label htmlFor="accidentMemo" className="text-xs text-gray-500">
                    状況メモ(口語でOK・音声入力可)
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setShowWritingHint(true)}
                      className="text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-600 px-2 py-1 rounded-md flex items-center gap-1 transition-colors"
                    >
                      💡 書き方のヒント
                    </button>
                    <button
                      type="button"
                      onClick={accidentVoice.toggle}
                      className={`text-xs px-2 py-1 rounded-md flex items-center gap-1 transition-colors ${
                        accidentVoice.listening
                          ? 'bg-red-100 text-red-700'
                          : 'bg-gray-100 hover:bg-gray-200 text-gray-600'
                      }`}
                    >
                      {accidentVoice.listening ? (
                        <>
                          <span className="animate-pulse">🔴</span> <span>停止する</span>
                        </>
                      ) : (
                        <>
                          <span>🎤</span> <span>音声入力</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
                <textarea
                  id="accidentMemo"
                  value={accidentMemo}
                  onChange={(e) => setAccidentMemo(e.target.value)}
                  rows={4}
                  placeholder={ACCIDENT_MEMO_PLACEHOLDER}
                  className="w-full border rounded-lg px-3 py-2 text-sm bg-gray-50"
                />
                {accidentVoice.error && <p className="text-red-500 text-xs mt-1">{accidentVoice.error}</p>}
              </div>

              <button
                type="button"
                onClick={handleGenerateAccident}
                disabled={generatingAccident || !accidentMemo.trim()}
                className="w-full py-2.5 bg-blue-50 hover:bg-blue-100 disabled:opacity-60 text-blue-700 font-bold rounded-lg text-sm"
              >
                {generatingAccident ? 'AI生成中…' : '✨ AIで項目に整理'}
              </button>

              {accidentError && <p className="text-red-500 text-sm">{accidentError}</p>}

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="accTargetName" className="text-xs text-gray-500 block mb-1">
                    対象者氏名
                  </label>
                  <input
                    id="accTargetName"
                    type="text"
                    value={accTargetName}
                    onChange={(e) => setAccTargetName(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm bg-gray-50"
                  />
                </div>
                <div>
                  <label htmlFor="accTargetDob" className="text-xs text-gray-500 block mb-1">
                    生年月日
                  </label>
                  <input
                    id="accTargetDob"
                    type="text"
                    value={accTargetDob}
                    onChange={(e) => setAccTargetDob(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm bg-gray-50"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="accOccurrenceTime" className="text-xs text-gray-500 block mb-1">
                  発生日時
                </label>
                <input
                  id="accOccurrenceTime"
                  type="text"
                  value={occurrenceTime}
                  onChange={(e) => setOccurrenceTime(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm bg-gray-50"
                />
              </div>

              {(
                [
                  ['location', '発生場所', location, setLocation],
                  ['accidentContent', '事故内容', accidentContent, setAccidentContent],
                  ['situation', '発生状況', situation, setSituation],
                  ['immediateResponse', '発生時の対応', immediateResponse, setImmediateResponse],
                  ['parentCorrespondence', '保護者への対応', parentCorrespondence, setParentCorrespondence],
                  ['diagnosisTreatment', '診断名および処置状況', diagnosisTreatment, setDiagnosisTreatment],
                  ['prevention', '事故防止に向けた今後の対応', prevention, setPrevention],
                ] as const
              ).map(([id, label, value, setter]) => (
                <div key={id}>
                  <label htmlFor={id} className="text-xs text-gray-500 block mb-1">
                    {label}
                  </label>
                  <textarea
                    id={id}
                    value={value}
                    onChange={(e) => setter(e.target.value)}
                    rows={2}
                    className="w-full border rounded-lg px-3 py-2 text-sm bg-gray-50"
                  />
                </div>
              ))}

              {accidentMessage && <p className="text-green-600 text-sm">{accidentMessage}</p>}

              <button
                type="button"
                onClick={handleSaveAccident}
                disabled={savingAccident}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold rounded-xl"
              >
                {savingAccident ? '保存中…' : `${reportType}を保存`}
              </button>
            </div>
          )}
        </div>
      </div>

      {hintType && <AssessmentHintModal type={hintType} onClose={() => setHintType(null)} />}
      {showWritingHint && (
        <WritingHintModal reportType={reportType} onClose={() => setShowWritingHint(false)} />
      )}
    </div>
  );
}
