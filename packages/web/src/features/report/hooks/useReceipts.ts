import { useCallback, useRef, useState } from 'react';
import { receiptsApi } from '../../../api/receipts';
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
import { pushRecentCustomer } from '../model/recentCustomers';

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

let nextImageId = 1;

export function useReceipts() {
  const [images, setImages] = useState<ReceiptImage[]>([]);
  const [handoff, setHandoff] = useState('');
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // 読み取りの結果が返る前にダイアログを開き直したら、その結果は捨てる
  const generationRef = useRef(0);
  const imagesRef = useRef(images);
  imagesRef.current = images;

  const reset = useCallback(() => {
    generationRef.current++;
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
          receiptDate: toDatetimeLocal(result.receiptDate) || nowDatetimeLocal(new Date()),
        }));
      } catch (e) {
        console.error('OCR Failed', e);
        if (generation !== generationRef.current) return;
        patchImage(id, (img) => ({
          loading: false,
          receiptDate: img.receiptDate || nowDatetimeLocal(new Date()),
        }));
      }
    },
    [patchImage],
  );

  /** 写真を足す(6枚を越えるときは足さずに知らせる) */
  const addFiles = useCallback(
    async (files: readonly File[]) => {
      if (files.length === 0) return;
      setDuplicateWarning(null);
      if (imagesRef.current.length + files.length > MAX_RECEIPT_IMAGES) {
        showToast('写真は6枚までです', true);
        return;
      }
      const generation = generationRef.current;
      await Promise.all(
        files.map(async (file) => {
          const data = await resizeImageFile(file);
          if (generation !== generationRef.current) return;
          const id = nextImageId++;
          setImages((prev) => [
            ...prev,
            { id, data, amount: '', storeName: '', receiptDate: '', loading: true },
          ]);
          void runOcr(id, data);
        }),
      );
    },
    [runOcr],
  );

  const removeImage = useCallback((id: number) => {
    setImages((prev) => {
      const next = prev.filter((img) => img.id !== id);
      if (next.length === 0) setDuplicateWarning(null);
      return next;
    });
  }, []);

  const updateImage = useCallback(
    (id: number, field: ReceiptEditableField, value: string) => patchImage(id, () => ({ [field]: value })),
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
      const generation = generationRef.current;
      try {
        const res = await receiptsApi.upload({
          customerId: ctx.customerId,
          customerNameText: ctx.customerId ? undefined : ctx.customerName || undefined,
          images: payloadImages,
          receiptTimestamp: ctx.fallbackTimestamp,
          handoffText: handoff.trim(),
        });
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
        if (ctx.customerId) pushRecentCustomer(ctx.customerId);
        setHandoff('');

        // すでに登録ずみだったものだけを残し、登録できたものは消す
        const duplicateIndexes = new Set(res.duplicates.map((d) => d.index));
        if (duplicateIndexes.size > 0) {
          // サーバーの応答にはお客様の名前が無いので、登録のあるお客様の名前を添える(GAS版と同じ)
          setDuplicateWarning(
            formatReceiptDuplicateWarning(res.duplicates, ctx.customerId ? ctx.customerName : ''),
          );
          setImages((prev) => prev.filter((_, idx) => duplicateIndexes.has(idx)));
        } else {
          setDuplicateWarning(null);
          setImages([]);
        }
        showToast(res.message || '領収書を送りました');
      } catch (e) {
        showErrorToast(e);
      } finally {
        if (generation === generationRef.current) setSending(false);
      }
    },
    [handoff],
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
    send,
  };
}

export type ReceiptsController = ReturnType<typeof useReceipts>;
