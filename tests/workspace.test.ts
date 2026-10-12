import { describe, expect, it } from 'vitest';
import { ResourceCache } from '../src/workspace/resources';

describe('workspace PDF resource ownership', () => {
  it('keeps the active and most recently used inactive resource and releases evictions', () => {
    const released: string[] = [];
    const cache = new ResourceCache<{ bytes: number; key: string }>(value => released.push(value.key));
    cache.put('a', { bytes: 1024, key: 'a' }); cache.put('b', { bytes: 1024, key: 'b' });
    cache.get('a'); cache.put('c', { bytes: 1024, key: 'c' });
    expect(cache.get('b')).toBeUndefined(); expect(released).toEqual(['b']);
    expect(cache.get('a')?.key).toBe('a'); expect(cache.get('c')?.key).toBe('c');
    cache.clear(); expect(released.sort()).toEqual(['a', 'b', 'c']);
  });
  it('evicts an inactive PDF larger than 32 MiB, retaining its active resource until switching', () => {
    const released: string[] = [], cache = new ResourceCache<{ bytes: number; key: string }>(value => released.push(value.key));
    cache.activate('large'); cache.put('large', { bytes: 32 * 1024 * 1024 + 1, key: 'large' });
    expect(cache.get('large')?.key).toBe('large'); cache.activate('small');
    expect(cache.get('large')).toBeUndefined(); expect(released).toEqual(['large']);
    cache.put('small', { bytes: 32 * 1024 * 1024, key: 'small' }); cache.activate('other'); expect(cache.get('small')?.key).toBe('small');
  });
  it('releases replaced resources exactly once and removal does not release neighboring resources', () => {
    const released: string[] = [], cache = new ResourceCache<{ bytes: number; key: string }>(value => released.push(value.key));
    cache.put('a', { bytes: 1, key: 'old' }); const replacement = { bytes: 1, key: 'new' };
    cache.put('a', replacement); cache.put('a', replacement); cache.put('b', { bytes: 1, key: 'b' }); cache.delete('a'); cache.delete('a');
    expect(released).toEqual(['old', 'new']); expect(cache.get('b')?.key).toBe('b');
  });
});
