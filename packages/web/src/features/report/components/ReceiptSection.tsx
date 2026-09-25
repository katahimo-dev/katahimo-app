import { type ChangeEvent, useRef } from 'react';
import type { ReceiptEditableField, ReceiptImage, ReceiptsController } from '../hooks/useReceipts';
import { cx } from './cx';

/**
 * 「レシート・領収書（6枚まで）」(日報モードと、お客様の指定なしの領収書で出す。GAS版 #imageUploadSection)。
 * 写真を足すとすぐに金額・お店の名前・日付を読み取る。
 */
export function ReceiptSection({
  hidden,
  receipts,
  onSend,
  onEdited,
}: {
  hidden: boolean;
  receipts: ReceiptsController;
  onSend: () => void;
  /** 入力が変わった(GAS版はダイアログ内のどの入力でも markDirty していた) */
  onEdited: () => void;
}) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const onFilesSelected = (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const files = Array.from(input.files ?? []);
    onEdited();
    void receipts.addFiles(files).finally(() => {
      input.value = '';
    });
  };

  const updateImage = (id: number, field: ReceiptEditableField, value: string) => {
    receipts.updateImage(id, field, value);
    onEdited();
  };

  return (
    <div id="imageUploadSection" className={cx('mt-4 border-t pt-3', hidden && 'hidden')}>
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className="block text-base font-bold text-gray-700">レシート・領収書（6枚まで）</span>
        {/* 送る操作なので緑。青の主ボタンは下のバー(AI生成/保存)だけにする */}
        <button
          type="button"
          onClick={onSend}
          id="uploadReceiptOnlyBtn"
          disabled={receipts.sending}
          className="min-h-12 text-base bg-green-600 text-white px-4 py-3 rounded-xl font-bold transition-colors whitespace-nowrap"
        >
          {receipts.sending ? '送っています…' : 'この領収書を送る'}
        </button>
      </div>
      <div
        id="receiptDuplicateWarning"
        className={cx(
          receipts.duplicateWarning === null && 'hidden',
          'mb-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800 whitespace-pre-wrap',
        )}
      >
        {receipts.duplicateWarning}
      </div>
      <div className="flex flex-wrap gap-2 items-start">
        <div id="imagePreviewContainer" className="flex flex-wrap gap-2">
          {receipts.images.map((img) => (
            <ReceiptImageCard
              key={img.id}
              image={img}
              removable={!receipts.sending}
              onRemove={() => receipts.removeImage(img.id)}
              onChange={(field, value) => updateImage(img.id, field, value)}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={() => cameraInputRef.current?.click()}
          id="addCameraBtn"
          className={cx(
            'w-24 h-24 border-2 border-dashed border-blue-300 rounded-xl flex flex-col items-center justify-center text-blue-700 active:bg-blue-50 transition-colors bg-white',
            !receipts.canAddMore && 'hidden',
          )}
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
              strokeWidth="2"
              d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
          <span className="text-sm font-bold">📷 撮る</span>
        </button>

        <button
          type="button"
          onClick={() => galleryInputRef.current?.click()}
          id="addGalleryBtn"
          className={cx(
            'w-24 h-24 border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center text-gray-600 active:border-gray-400 transition-colors bg-gray-50',
            !receipts.canAddMore && 'hidden',
          )}
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
              strokeWidth="2"
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          <span className="text-sm font-bold">🖼️ 写真から選ぶ</span>
        </button>
      </div>
      <input
        ref={cameraInputRef}
        type="file"
        id="cameraInput"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onFilesSelected}
      />
      <input
        ref={galleryInputRef}
        type="file"
        id="galleryInput"
        accept="image/*"
        multiple
        className="hidden"
        onChange={onFilesSelected}
      />
      <div className="mt-3">
        <label htmlFor="receiptHandoff" className="block text-base font-bold text-gray-700 mb-1">
          事務局へのひとこと（あれば）
        </label>
        <textarea
          id="receiptHandoff"
          rows={2}
          value={receipts.handoff}
          onChange={(e) => {
            receipts.setHandoff(e.target.value);
            onEdited();
          }}
          className="w-full p-3 rounded-xl border border-gray-300 bg-white text-base focus:ring-2 focus:ring-blue-500"
          placeholder="あれば書いてください"
        />
      </div>
    </div>
  );
}

function ReceiptImageCard({
  image,
  removable,
  onRemove,
  onChange,
}: {
  image: ReceiptImage;
  /** 送っている間は消せない */
  removable: boolean;
  onRemove: () => void;
  onChange: (field: ReceiptEditableField, value: string) => void;
}) {
  return (
    <div className="relative w-40 flex flex-col gap-1 items-center">
      <div className="relative w-24 h-24 rounded-xl overflow-hidden shadow-sm border border-gray-200 group bg-gray-100">
        <img src={image.data} alt="レシート・領収書の写真" className="w-full h-full object-cover" />
        <button
          type="button"
          onClick={onRemove}
          disabled={!removable}
          aria-label="この写真を消す"
          className="absolute top-1 right-1 bg-red-600 text-white rounded-full w-8 h-8 flex items-center justify-center text-base font-bold shadow-md z-10"
        >
          &times;
        </button>
        {image.loading ? (
          <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-1 p-1">
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full loading-spinner" />
            <div className="text-sm text-white text-center leading-tight">金額を読み取っています…</div>
          </div>
        ) : null}
      </div>
      <div className="w-full px-1">
        <div className="text-sm text-blue-700 font-bold text-left pl-1 mb-0.5">レシートの日付</div>
        <input
          type="datetime-local"
          value={image.receiptDate}
          onChange={(e) => onChange('receiptDate', e.target.value)}
          aria-label="レシートの日付"
          title="レシートの日付（自動で読み取ります。直せます）"
          className="w-full min-h-11 p-2 text-sm border border-blue-300 rounded-xl text-center focus:ring-1 focus:ring-blue-500 bg-blue-50 font-bold"
        />
      </div>
      <div className="w-full px-1">
        <input
          type="number"
          value={image.amount}
          aria-label="金額（円）"
          placeholder="金額（円）"
          step="100"
          onChange={(e) => onChange('amount', e.target.value)}
          className="w-full min-h-11 p-2 text-sm border border-gray-300 rounded-xl text-center focus:ring-1 focus:ring-blue-500"
        />
      </div>
      <div className="w-full px-1">
        <input
          type="text"
          value={image.storeName}
          aria-label="お店の名前"
          placeholder="お店の名前"
          onChange={(e) => onChange('storeName', e.target.value)}
          className="w-full min-h-11 p-2 text-sm border border-gray-300 rounded-xl text-center focus:ring-1 focus:ring-blue-500"
        />
      </div>
    </div>
  );
}
