import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiRequestError } from '../../../api/client';
import { queryKeys } from '../../../api/queryKeys';
import { receiptsApi } from '../../../api/receipts';
import { pushRecentCustomer } from '../../../lib/recentCustomers';
import type { UserStorageScope } from '../../../lib/storage';
import { showErrorToast, showToast } from '../../../ui/toast';
import {
  findLocalReceiptDuplicates,
  formatReceiptDuplicateWarning,
  loadReceiptKeyMap,
  recordSentReceipts,
  saveReceiptKeyMap,
} from '../model/receiptDedup';
import {
  fromDatetimeLocal,
  MAX_RECEIPT_IMAGES,
  nowDatetimeLocal,
  resizeImageFile,
  toDatetimeLocal,
} from '../model/receiptImage';

/**
 * 「レシート・領収書（6枚まで）」の写真・入力・送信(GAS版 currentImages / handleFileSelect /
 * resizeAndAddImage / runOcr / uploadReceiptsOnly)。
 */
export interface ReceiptImage {
  id: number;
  /** 縮めた JPEG の data URL */
  data: string;
  /** 金額(入力欄の値。OCRの結果は数値のこともある) */
  amount: string;
  storeName: string;
  /** datetime-local の値 'yyyy-MM-ddTHH:mm' */
  receiptDate: string;
  /** 会社負担(研修等の同行・会社の都合。お客様に請求しない)。既定は false */
  companyPaid: boolean;
  /** 金額を読み取っているあいだ true */
  loading: boolean;
}

export type ReceiptEditableField = 'amount' | 'storeName' | 'receiptDate';

export interface ReceiptSendContext {
  staffName: string;
  /** お客様の指定なし(新しいお客様)なら null */
  customerId: string | null;
  /** 重複の文・通知に使うお客様の名前(指定なしなら入力された名前) */
  customerName: string;
  /** 画像ごとの日時が無いときの日時(日報の日付 + 始めた時間) */
  fallbackTimestamp: string;
}

/** 写真を読み込めなかったとき(GAS版は何も出さずに足さなかった) */
export const IMAGE_LOAD_FAILED_MESSAGE = '写真を読み込めませんでした。別の写真を選んでください';

let nextImageId = 1;

export function useReceipts(storageScope: UserStorageScope) {
  const queryClient = useQueryClient();
  const [images, setImages] = useState<ReceiptImage[]>([]);
  const [handoff, setHandoff] = useState('');
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // 読み取りの結果が返る前にダイアログを開き直したら、その結果は捨てる
  const generationRef = useRef(0);
  const imagesRef = useRef(images);
  useEffect(() => {
    imagesRef.current = images;
  });
  const sendingRef = useRef(false);
  /** 縮めている途中の写真の枚数(6枚までの数に入れる。縮め終わる前に続けて選ばれても越えないように) */
  const reservedRef = useRef(0);

  const reset = useCallback(() => {
    generationRef.current++;
    reservedRef.current = 0;
    sendingRef.current = false;
    imagesRef.current = [];
    setImages([]);
    setHandoff('');
    setDuplicateWarning(null);
    setSending(false);
  }, []);

  const patchImage = useCallback((id: number, patch: (img: ReceiptImage) => Partial<ReceiptImage>) => {
    setImages((prev) => prev.map((img) => (img.id === id ? { ...img, ...patch(img) } : img)));
  }, []);

  const runOcr = useCallback(
    async (id: number, data: string) => {
      const generation = generationRef.current;
      try {
        const { result } = await receiptsApi.ocr(data);
        if (generation !== generationRef.current) return;
        patchImage(id, (img) => ({
          loading: false,
          amount: result.amount ? String(result.amount) : img.amount,
          storeName: result.storeName || img.storeName,
          // 読み取れた日時、読めなければ今の日時
          receiptDate: toDatetimeLocal(result.receiptDate) || nowDatetimeLocal(),
        }));
      } catch (e) {
        console.error('OCR Failed', e);
        if (generation !== generationRef.current) return;
        // 読み取りの失敗はGAS版と同じく知らせない(手で入れればよい)。ただし回数の上限に達したときは、
        // 続けて写真を足しても読み取られないので知らせる
        if (e instanceof ApiRequestError && e.code === 'rate_limited') showErrorToast(e);
        patchImage(id, (img) => ({
          loading: false,
          receiptDate: img.receiptDate || nowDatetimeLocal(),
        }));
      }
    },
    [patchImage],
  );

  /** 写真を足す(6枚を越えるときは足さずに知らせる)。1枚でも読み込めなければ知らせる */
  const addFiles = useCallback(
    async (files: readonly File[]) => {
      if (files.length === 0) return;
      setDuplicateWarning(null);
      if (imagesRef.current.length + reservedRef.current + files.length > MAX_RECEIPT_IMAGES) {
        showToast('写真は6枚までです', true);
        return;
      }
      const generation = generationRef.current;
      reservedRef.current += files.length;
      const results = await Promise.allSettled(
        files.map(async (file) => {
          try {
            const data = await resizeImageFile(file);
            if (generation !== generationRef.current) return;
            const id = nextImageId++;
            const image: ReceiptImage = {
              id,
              data,
              amount: '',
              storeName: '',
              receiptDate: '',
              companyPaid: false,
              loading: true,
            };
            imagesRef.current = [...imagesRef.current, image];
            setImages((prev) => [...prev, image]);
            void runOcr(id, data);
          } finally {
            if (generation === generationRef.current) reservedRef.current -= 1;
          }
        }),
      );
      if (generation !== generationRef.current) return;
      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length > 0) {
        console.error('写真を読み込めませんでした', failed);
        showToast(IMAGE_LOAD_FAILED_MESSAGE, true);
      }
    },
    [runOcr],
  );

  const removeImage = useCallback((id: number) => {
    // 送っている間は消せない(送った写真と、重複の知らせの対応がずれないように)
    if (sendingRef.current) return;
    setImages((prev) => prev.filter((img) => img.id !== id));
    if (imagesRef.current.every((img) => img.id === id)) setDuplicateWarning(null);
  }, []);

  const updateImage = useCallback(
    (id: number, field: ReceiptEditableField, value: string) => patchImage(id, () => ({ [field]: value })),
    [patchImage],
  );

  /** 「会社負担(お客様に請求しない)」の切り替え */
  const setCompanyPaid = useCallback(
    (id: number, companyPaid: boolean) => patchImage(id, () => ({ companyPaid })),
    [patchImage],
  );

  /** 「この領収書を送る」 */
  const send = useCallback(
    async (ctx: ReceiptSendContext) => {
      const current = imagesRef.current;
      if (current.length === 0) {
        showToast('レシート・領収書の写真を追加してください', true);
        return;
      }
      if (current.some((img) => img.loading)) {
        showToast('写真から金額を読み取っています。少し待ってからもう一度押してください', true);
        return;
      }

      const customerKey = ctx.customerId ?? '';
      const payloadImages = current.map((img) => ({
        data: img.data,
        amount: img.amount,
        storeName: img.storeName,
        receiptDate: fromDatetimeLocal(img.receiptDate),
        companyPaid: img.companyPaid,
      }));

      const localDuplicates = findLocalReceiptDuplicates(payloadImages, {
        customerId: customerKey,
        customerName: ctx.customerName,
        fallbackTimestamp: ctx.fallbackTimestamp,
        sent: loadReceiptKeyMap(ctx.staffName, Date.now()),
      });
      if (localDuplicates.length > 0) {
        setDuplicateWarning(formatReceiptDuplicateWarning(localDuplicates, ctx.customerName));
        showToast('この領収書は前に送ってあります', true);
        return;
      }

      setDuplicateWarning(null);
      setSending(true);
      sendingRef.current = true;
      const generation = generationRef.current;
      /** 送った写真のID(応答の重複は送った順の番号で返るため、IDに置きかえて扱う) */
      const sentIds = current.map((img) => img.id);
      try {
        const res = await receiptsApi.upload({
          customerId: ctx.customerId,
          customerNameText: ctx.customerId ? undefined : ctx.customerName || undefined,
          images: payloadImages,
          receiptTimestamp: ctx.fallbackTimestamp,
          handoffText: handoff.trim(),
        });
        // 領収書の一覧(出勤簿タブの「🧾 領収書」)を読み直させる(ダイアログを開き直していても、送った分はサーバーにある)
        void queryClient.invalidateQueries({ queryKey: queryKeys.receipts.all });
        if (generation !== generationRef.current) return;
        const now = Date.now();
        saveReceiptKeyMap(
          ctx.staffName,
          recordSentReceipts(loadReceiptKeyMap(ctx.staffName, now), payloadImages, {
            customerId: customerKey,
            fallbackTimestamp: ctx.fallbackTimestamp,
            now,
          }),
          now,
        );
        if (ctx.customerId) pushRecentCustomer(ctx.customerId, storageScope);
        setHandoff('');

        // すでに登録ずみだったものだけを残し、登録できたものは消す(送っている間に足した写真は残す)
        const duplicateIds = new Set(res.duplicates.map((d) => sentIds[d.index]));
        const sent = new Set(sentIds);
        setImages((prev) => prev.filter((img) => duplicateIds.has(img.id) || !sent.has(img.id)));
        // サーバーの応答にはお客様の名前が無いので、登録のあるお客様の名前を添える(GAS版と同じ)
        setDuplicateWarning(
          duplicateIds.size > 0
            ? formatReceiptDuplicateWarning(res.duplicates, ctx.customerId ? ctx.customerName : '')
            : null,
        );
        showToast(res.message || '領収書を送りました');
      } catch (e) {
        showErrorToast(e);
      } finally {
        if (generation === generationRef.current) {
          sendingRef.current = false;
          setSending(false);
        }
      }
    },
    [handoff, storageScope, queryClient],
  );

  return {
    images,
    handoff,
    setHandoff,
    duplicateWarning,
    sending,
    canAddMore: images.length < MAX_RECEIPT_IMAGES,
    reset,
    addFiles,
    removeImage,
    updateImage,
    setCompanyPaid,
    send,
  };
}

export type ReceiptsController = ReturnType<typeof useReceipts>;
