import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cloudConfig } from './config.ts';

test('Vercel requires real shared storage, never an ephemeral local fallback', () => {
  assert.throws(() => cloudConfig({}), /REDIS_URL is required/);
  assert.throws(() => cloudConfig({ REDIS_URL: 'https://example.com' }), /not a REST API/);
  assert.throws(() => cloudConfig({ REDIS_URL: 'redis://localhost:6379', REDIS_PREFIX: 'bad:{prefix}' }), /REDIS_PREFIX/);
  assert.equal(cloudConfig({ REDIS_URL: 'redis://localhost:6379', VERCEL_ENV: 'production' }).prefix, 'classroom-production');
  assert.equal(cloudConfig({ REDIS_URL: 'rediss://localhost:6379', VERCEL_ENV: 'preview' }).prefix, 'classroom-preview');
  assert.equal(cloudConfig({ REDIS_URL: 'redis://localhost:6379', REDIS_PREFIX: 'meeting-november' }).prefix, 'meeting-november');
});
