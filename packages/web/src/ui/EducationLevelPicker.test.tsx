import { EDUCATION_LEVEL_DEFINITIONS } from '@katahimo/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EducationLevelPicker } from './EducationLevelPicker';

function renderPicker(educationLevel: number | null | undefined, onSelect = vi.fn()) {
  render(
    <EducationLevelPicker
      labelId="levelLabel"
      heading="🎓 ご家庭の教育への関心（教育思考★）"
      educationLevel={educationLevel}
      disabled={false}
      onSelect={onSelect}
    />,
  );
  return onSelect;
}

describe('EducationLevelPicker', () => {
  it('★で選び、選んだ段階の呼称と教育語の使い方を出す。☆0 で未設定に戻す', () => {
    const onSelect = renderPicker(3);
    const group = screen.getByRole('radiogroup', { name: /教育思考★/ });
    expect(within(group).getByRole('radio', { name: '★3' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('★3 やや関心あり')).toBeTruthy();
    expect(screen.getByText('教育語: 平易な教育概念を1語、意味づけとともに。')).toBeTruthy();

    fireEvent.click(within(group).getByRole('radio', { name: '★5' }));
    expect(onSelect).toHaveBeenLastCalledWith(5);
    fireEvent.click(within(group).getByRole('radio', { name: '☆0 未設定' }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
    // 選んでいる★をもう一度押しても送らない
    onSelect.mockClear();
    fireEvent.click(within(group).getByRole('radio', { name: '★3' }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('未設定は ☆0 を選んだ状態にし、★2 として書くことを出す。矢印キーでも選べる', () => {
    const onSelect = renderPicker(null);
    const zero = screen.getByRole('radio', { name: '☆0 未設定' });
    expect(zero.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('未設定（★2 標準として書きます）')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowRight' });
    expect(onSelect).toHaveBeenLastCalledWith(1);
  });

  it('読み込み中は押せない', () => {
    renderPicker(undefined);
    expect((screen.getByRole('radio', { name: '★4' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('「❓ 説明」で段階ごとの呼称・想定顧客像・教育語の使い方の表を開く', async () => {
    renderPicker(2);
    fireEvent.click(screen.getByRole('button', { name: '❓ 説明' }));
    const dialog = await screen.findByRole('dialog', { name: EDUCATION_LEVEL_DEFINITIONS.title });
    for (const level of EDUCATION_LEVEL_DEFINITIONS.levels) {
      expect(within(dialog).getByText(`★${level.score}`)).toBeTruthy();
      expect(within(dialog).getByText(level.customerProfile)).toBeTruthy();
      expect(within(dialog).getByText(level.usage)).toBeTruthy();
    }
  });
});
