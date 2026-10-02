import { describe, expect, it } from 'vitest';
import { type DemoTermsValues, demoBannerText, demoLoginNoticeLines, demoTermsSections } from './demo';

const both: DemoTermsValues = { dataRetentionDays: 30, logRetentionMonths: 3, aiUsesPerSession: 10 };

function storageSection(values: DemoTermsValues | null): string[] {
  return (
    demoTermsSections(values).find((s) => s.heading === '入力した内容・接続情報の保存')?.paragraphs ?? []
  );
}

function allText(values: DemoTermsValues | null): string {
  return [
    ...demoLoginNoticeLines(values),
    ...demoTermsSections(values).flatMap((s) => s.paragraphs),
    demoBannerText(values),
  ].join('\n');
}

describe('公開デモの文言(保存期間)', () => {
  it('日数・月数があれば、その期間と毎晩の作り直しを書く', () => {
    expect(demoLoginNoticeLines(both)[1]).toBe(
      '入力した内容（30日間）と、操作ログ・接続情報（IPアドレス等。3か月間）を保存し、サービスの改善と不正利用の調査に使います。',
    );
    expect(storageSection(both)).toEqual([
      'データは架空のもので、毎晩作り直します。',
      '作り直したあとも、入力した内容は運営者が30日間、操作ログ・接続情報（IPアドレス等）は3か月間保存し、サービスの改善と不正利用の調査に使います。',
    ]);
    expect(demoBannerText(both)).toContain('毎晩作り直します');
  });

  it('日数だけ: 操作ログの期間は書かない', () => {
    const values = { ...both, logRetentionMonths: null };
    expect(demoLoginNoticeLines(values)[1]).toBe(
      '入力した内容（30日間）と、操作ログ・接続情報（IPアドレス等）を保存し、サービスの改善と不正利用の調査に使います。',
    );
    expect(storageSection(values)[1]).toBe(
      '作り直したあとも、入力した内容は運営者が30日間保存し、操作ログ・接続情報（IPアドレス等）も保存して、サービスの改善と不正利用の調査に使います。',
    );
  });

  it('日数が無い(本番の環境に置いたデモ用テナント): 毎晩の作り直しも入力の期間も書かない', () => {
    const values = { ...both, dataRetentionDays: null, logRetentionMonths: 13 };
    expect(demoLoginNoticeLines(values)[1]).toBe(
      '入力した内容と、操作ログ・接続情報（IPアドレス等。13か月間）を保存し、サービスの改善と不正利用の調査に使います。',
    );
    expect(storageSection(values)).toEqual([
      'データは架空のものです。',
      '入力した内容と、操作ログ・接続情報（IPアドレス等。13か月間）は運営者が保存し、サービスの改善と不正利用の調査に使います。',
    ]);
    expect(allText(values)).not.toMatch(/毎晩|日間|その日に/);
  });

  it('設定を読めなかった(null)ときも、期間・毎晩の作り直しを書かない', () => {
    expect(allText(null)).not.toMatch(/毎晩|日間|か月間|一定期間/);
    expect(demoBannerText(null)).toBe(
      'デモ環境です。データは架空のものです。入力した内容は保存され、ほかの閲覧者にも見えます。',
    );
  });
});
