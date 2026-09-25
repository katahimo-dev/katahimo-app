import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// vitest は globals を使っていないため、@testing-library/react の自動の後片付けが動かない。ここで行う。
afterEach(() => {
  cleanup();
  localStorage.clear();
});
