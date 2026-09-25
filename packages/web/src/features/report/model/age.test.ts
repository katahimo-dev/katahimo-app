import { describe, expect, it } from 'vitest';
import { calculateAge, toFullWidthDigits } from './age';

describe('calculateAge(GAS版: 数字は全角)', () => {
  const today = new Date(2026, 8, 25); // 2026-09-25

  it('「（１歳２か月）」の形', () => {
    expect(calculateAge('2025/07/12', today)).toBe('（１歳２か月）');
  });
  it('0歳・2桁も全角', () => {
    expect(calculateAge('2025/11/03', today)).toBe('（０歳１０か月）');
    expect(calculateAge('1990/01/15', today)).toBe('（３６歳８か月）');
  });
  it('誕生日の前日までは月を数えない', () => {
    expect(calculateAge('2024/09/26', today)).toBe('（１歳１１か月）');
    expect(calculateAge('2024/09/25', today)).toBe('（２歳０か月）');
  });
  it('形が違う・空なら空文字', () => {
    expect(calculateAge('', today)).toBe('');
    expect(calculateAge(null, today)).toBe('');
    expect(calculateAge('2024-09-25', today)).toBe('');
  });
  it('toFullWidthDigits', () => {
    expect(toFullWidthDigits(1203)).toBe('１２０３');
  });
});
