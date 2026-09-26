import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DailyResult } from './DailyResult';

describe('AIが書いた日報', () => {
  it('使った教育キーワードは候補の語だけ緑で、候補外・表に無い答えは灰色に印を付ける', () => {
    render(
      <DailyResult
        shown
        internalText="社内"
        customerText="保護者"
        onChange={() => {}}
        aiInfo={{
          generationId: null,
          usedKeywords: [
            { code: 'K01', keyword: '見守りの語', status: 'used' },
            { code: 'K02', keyword: '協力の語', status: 'not_offered' },
            { code: 'X99 謎の語', keyword: null, status: 'unknown' },
          ],
          candidateCount: 3,
          escalationRequired: false,
          childAgeMonths: 14,
          educationLevel: 2,
          effectiveEducationLevel: 2,
        }}
      />,
    );
    expect(screen.getByText('K01 見守りの語').className).toContain('bg-green-100');
    const notOffered = screen.getByText('K02 協力の語（候補外）');
    expect(notOffered.className).toContain('bg-gray-100');
    expect(screen.getByText('X99 謎の語（表に無い）').className).toContain('bg-gray-100');
  });
});
