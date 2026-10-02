import { describe, expect, it } from 'vitest';
import { demoResetTargetProblem } from './demoReset';

describe('demo:reset の対象の確かめ', () => {
  it('DEMO_TENANT_SLUG と一致する slug だけ受け付ける', () => {
    expect(demoResetTargetProblem('public-demo', 'public-demo')).toBeNull();
    expect(demoResetTargetProblem('cutest', 'public-demo')).toContain('DEMO_TENANT_SLUG');
    expect(demoResetTargetProblem('public-demo', undefined)).toContain('未設定');
    expect(demoResetTargetProblem(undefined, 'public-demo')).toContain('使い方');
  });

  it('開発用シード・e2e の demo は、DEMO_TENANT_SLUG が demo でも断る', () => {
    expect(demoResetTargetProblem('demo', 'demo')).toContain('開発用シード');
  });
});
