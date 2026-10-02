import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DEMO_NO_REAL_PERSON } from '../../../lib/demo';
import { MemoSection } from './MemoSection';

function renderMemo(inputNotice: string | null) {
  return render(
    <MemoSection
      hidden={false}
      mode="daily"
      memo=""
      placeholder="いつもの案内文"
      inputNotice={inputNotice}
      accidentType="事故報告"
      listening={false}
      warnings={null}
      aiFailure={null}
      warningsRef={null}
      onMemoChange={() => undefined}
      onAccidentTypeChange={() => undefined}
      onOpenHint={() => undefined}
      onToggleVoice={() => undefined}
    />,
  );
}

describe('今日の出来事メモ: 公開デモの注意', () => {
  it('注意を渡すと欄のすぐ下に出し、欄の説明にする(いつもの案内文はそのまま)', () => {
    renderMemo(DEMO_NO_REAL_PERSON);
    const input = screen.getByLabelText('今日の出来事メモ');
    expect(input.getAttribute('placeholder')).toBe('いつもの案内文');
    expect(screen.getByText(`⚠️ ${DEMO_NO_REAL_PERSON}`)).toBeTruthy();
    expect(input.getAttribute('aria-describedby')).toBe('reportInputNotice');
  });

  it('ふだんは出さない', () => {
    renderMemo(null);
    expect(screen.queryByText(/実在の人物/)).toBeNull();
    expect(screen.getByLabelText('今日の出来事メモ').getAttribute('aria-describedby')).toBeNull();
  });
});
