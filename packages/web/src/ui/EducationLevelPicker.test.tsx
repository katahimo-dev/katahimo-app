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
  it('★で選び、選んだ段階の呼称と教育語の使い方を出す', () => {
    const onSelect = renderPicker(3);
    const group = screen.getByRole('radiogroup', { name: /教育思考★/ });
    expect(within(group).getByRole('radio', { name: '★3' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('★3 やや関心あり')).toBeTruthy();
    expect(screen.getByText('教育語: 平易な教育概念を1語、意味づけとともに。')).toBeTruthy();
    // ☆0(未設定に戻す)は置かない
    expect(within(group).getAllByRole('radio')).toHaveLength(5);

    fireEvent.click(within(group).getByRole('radio', { name: '★5' }));
    expect(onSelect).toHaveBeenLastCalledWith(5);
    // 選んでいる★をもう一度押しても送らない
    onSelect.mockClear();
    fireEvent.click(within(group).getByRole('radio', { name: '★3' }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('未設定は★2 標準を選んだ状態で見せ、★2 を押しても送らない。矢印キーでも選べる', () => {
    const onSelect = renderPicker(null);
    expect(screen.getByRole('radio', { name: '★2' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('★2 標準')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: '★2' }));
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowRight' });
    expect(onSelect).toHaveBeenLastCalledWith(3);
  });

  it('保存中は押しても送らず、フォーカスは★に残す(disabled にしない)', () => {
    const onSelect = vi.fn();
    render(<EducationLevelPicker labelId="l" educationLevel={2} disabled onSelect={onSelect} />);
    const star = screen.getByRole('radio', { name: '★2' }) as HTMLButtonElement;
    star.focus();
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowRight' });
    fireEvent.click(screen.getByRole('radio', { name: '★4' }));
    expect(onSelect).not.toHaveBeenCalled();
    expect(star.disabled).toBe(false);
    expect(document.activeElement).toBe(star);
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
