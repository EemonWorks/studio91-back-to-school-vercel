export function cloudConfig(env: NodeJS.ProcessEnv) {
  const url = env.REDIS_URL;
  if (!url) throw new Error('Shared storage is not connected. In Vercel, open Storage, connect Redis Cloud to this project, then redeploy. REDIS_URL is required.');
  const parsed = new URL(url);
  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    throw new Error('REDIS_URL must be a Redis TCP/TLS connection string, not a REST API URL.');
  }
  const defaultPrefix = env.VERCEL_ENV === 'production' ? 'classroom-production' : 'classroom-preview';
  const prefix = env.REDIS_PREFIX || defaultPrefix;
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(prefix)) throw new Error('REDIS_PREFIX must contain 1-80 letters, digits, underscores, or hyphens.');
  return { url, prefix };
}
