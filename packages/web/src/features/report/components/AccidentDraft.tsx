import type { Ref } from 'react';
import type { AccidentFields } from '../model/reportForm';
import { cx } from './cx';

interface FieldDef {
  field: keyof AccidentFields;
  id: string;
  label: string;
  /** 後ろに小さく添える、正式な項目名 */
  formal: string;
  /** textarea の行数(無ければ1行の入力欄) */
  rows?: number;
}

const INPUT_CLASS = 'w-full p-3 rounded-xl border border-gray-300 text-base';

const TARGET_FIELDS: FieldDef[] = [
  { field: 'targetName', id: 'accTargetName', label: 'お子様の名前', formal: '（対象児童名）' },
  { field: 'targetDob', id: 'accTargetDob', label: '生まれた日', formal: '（生年月日）' },
];

const DETAIL_FIELDS: FieldDef[] = [
  { field: 'occurrenceTime', id: 'accOccurrenceTime', label: '起きた日時', formal: '（発生日時）' },
  { field: 'location', id: 'accLocation', label: '起きた場所', formal: '（発生場所）' },
  { field: 'accidentContent', id: 'accContent', label: '何が起きたか', formal: '（事故内容）' },
  { field: 'situation', id: 'accSituation', label: 'くわしい状況', formal: '（発生状況）', rows: 3 },
  {
    field: 'immediateResponse',
    id: 'accResponse',
    label: 'その場でしたこと',
    formal: '（発生時の対応）',
    rows: 3,
  },
  {
    field: 'parentCorrespondence',
    id: 'accParentCorrespondence',
    label: 'おうちの方への連絡',
    formal: '（保護者への対応）',
    rows: 3,
  },
  {
    field: 'diagnosisTreatment',
    id: 'accDiagnosis',
    label: '病院での診断・手当て',
    formal: '（診断名・処置）',
    rows: 2,
  },
  { field: 'prevention', id: 'accPrevention', label: 'これからの対策', formal: '（今後の対応）', rows: 3 },
];

/** AIが書いた事故報告書の下書き(GAS版 #accidentResultArea)。どの欄も直せる。 */
export function AccidentDraft({
  shown,
  values,
  containerRef,
  onChange,
}: {
  shown: boolean;
  values: AccidentFields;
  containerRef: Ref<HTMLDivElement>;
  onChange: (field: keyof AccidentFields, value: string) => void;
}) {
  return (
    <div
      id="accidentResultArea"
      ref={containerRef}
      className={cx(!shown && 'hidden', 'space-y-4 pt-4 border-t')}
    >
      <h3 className="text-base font-bold text-gray-800 border-b pb-2">
        事故報告書（AIの下書き）— 内容を確認して直してください
      </h3>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          {TARGET_FIELDS.map((def) => (
            <AccidentField key={def.field} def={def} value={values[def.field]} onChange={onChange} />
          ))}
        </div>
        {DETAIL_FIELDS.map((def) => (
          <AccidentField key={def.field} def={def} value={values[def.field]} onChange={onChange} />
        ))}
      </div>
    </div>
  );
}

function AccidentField({
  def,
  value,
  onChange,
}: {
  def: FieldDef;
  value: string;
  onChange: (field: keyof AccidentFields, value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={def.id} className="block text-base font-bold text-gray-700">
        {def.label}
        <span className="text-sm text-gray-600 font-normal">{def.formal}</span>
      </label>
      {def.rows ? (
        <textarea
          id={def.id}
          rows={def.rows}
          value={value}
          onChange={(e) => onChange(def.field, e.target.value)}
          className={INPUT_CLASS}
        />
      ) : (
        <input
          type="text"
          id={def.id}
          value={value}
          onChange={(e) => onChange(def.field, e.target.value)}
          className={INPUT_CLASS}
        />
      )}
    </div>
  );
}
