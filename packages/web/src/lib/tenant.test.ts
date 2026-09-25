import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from './memoryStorage.test-helper';
import { normalizeTenantSlug, rememberTenantSlug, resolveTenant, tenantSlugFromSubdomain } from './tenant';

describe('resolveTenant', () => {
  it('ビルド時の既定値 → URLの ?t= → サブドメイン → 前回の値 の順に決める', () => {
    const all = {
      envDefault: 'env-co',
      search: '?t=query-co',
      hostname: 'sub-co.katahimo.example.com',
      baseDomain: 'katahimo.example.com',
      storedSlug: 'stored-co',
    };
    expect(resolveTenant(all)).toEqual({ slug: 'env-co', source: 'env' });
    expect(resolveTenant({ ...all, envDefault: '' })).toEqual({ slug: 'query-co', source: 'query' });
    expect(resolveTenant({ ...all, envDefault: undefined, search: '' })).toEqual({
      slug: 'sub-co',
      source: 'subdomain',
    });
    expect(resolveTenant({ ...all, envDefault: undefined, search: '?x=1', hostname: 'localhost' })).toEqual({
      slug: 'stored-co',
      source: 'storage',
    });
  });

  it('どれでも決まらなければ null(ログイン画面に「法人ID」欄を出す)', () => {
    expect(resolveTenant({})).toBeNull();
    expect(resolveTenant({ search: '?t=', hostname: 'localhost', storedSlug: null })).toBeNull();
  });

  it('法人IDとして不正な値は使わずに次の候補へ進む', () => {
    expect(resolveTenant({ envDefault: '  ', search: '?t=<script>', storedSlug: 'demo' })).toEqual({
      slug: 'demo',
      source: 'storage',
    });
  });

  it('?t= は大文字・前後の空白を正規化する', () => {
    expect(resolveTenant({ search: 't=%20Demo%20' })).toEqual({ slug: 'demo', source: 'query' });
  });
});

describe('tenantSlugFromSubdomain', () => {
  it('ベースドメインが無ければサブドメインは見ない', () => {
    expect(tenantSlugFromSubdomain('demo.katahimo.example.com', undefined)).toBeNull();
    expect(tenantSlugFromSubdomain('demo.katahimo.example.com', '')).toBeNull();
  });

  it('ベースドメインそのもの・www・多段のサブドメインは法人IDにしない', () => {
    expect(tenantSlugFromSubdomain('katahimo.example.com', 'katahimo.example.com')).toBeNull();
    expect(tenantSlugFromSubdomain('www.katahimo.example.com', 'katahimo.example.com')).toBeNull();
    expect(tenantSlugFromSubdomain('a.b.katahimo.example.com', 'katahimo.example.com')).toBeNull();
    expect(tenantSlugFromSubdomain('evilkatahimo.example.com', 'katahimo.example.com')).toBeNull();
  });

  it('<法人ID>.<ベースドメイン> なら法人ID', () => {
    expect(tenantSlugFromSubdomain('Demo.katahimo.example.com', '.katahimo.example.com')).toBe('demo');
  });
});

describe('normalizeTenantSlug / rememberTenantSlug', () => {
  it('英小文字・数字・ハイフンだけを受け付ける', () => {
    expect(normalizeTenantSlug('demo-01')).toBe('demo-01');
    expect(normalizeTenantSlug('-demo')).toBeNull();
    expect(normalizeTenantSlug('de mo')).toBeNull();
    expect(normalizeTenantSlug('日本')).toBeNull();
  });

  it('ログインできた法人IDを覚える', () => {
    const storage = createMemoryStorage();
    rememberTenantSlug(' Demo ', storage);
    expect(storage.snapshot()).toEqual({ katahimo_last_tenant_slug: 'demo' });
    rememberTenantSlug('不正', storage);
    expect(storage.snapshot()).toEqual({ katahimo_last_tenant_slug: 'demo' });
  });
});
