export const createRoomScript = `
if redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
if redis.call('SCARD', KEYS[1]) >= 500 then return -1 end
redis.call('SADD', KEYS[1], ARGV[1])
redis.call('HSET', KEYS[2], '_createdAt', ARGV[2], '_revision', '0')
return 1
`;

export const voteScript = `
if redis.call('EXISTS', KEYS[1]) == 0 then return {':missing'} end
local updates = cjson.decode(ARGV[1])
local added = {}
local total = redis.call('HLEN', KEYS[1]) - 2
for _, item in ipairs(updates) do
  local field = 'v:' .. item.token
  if redis.call('HEXISTS', KEYS[1], field) == 0 and not added[field] then
    total = total + 1
    added[field] = true
  end
end
if total > 1000 then return {':full'} end
for _, item in ipairs(updates) do
  redis.call('HSET', KEYS[1], 'v:' .. item.token, cjson.encode(item.vote))
end
redis.call('HINCRBY', KEYS[1], '_revision', #updates)
return redis.call('HGETALL', KEYS[1])
`;

export const createLimitScript = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], 3600) end
return count <= 20 and 1 or 0
`;

const clockAndPrune = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local function publish(id, cursor)
  redis.call('PUBLISH', KEYS[4], cjson.encode({
    type = 'cursor', id = id, cursor = cursor,
    online = redis.call('ZCARD', KEYS[1])
  }))
end
local expired = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', now - 45000)
for _, id in ipairs(expired) do
  redis.call('ZREM', KEYS[1], id)
  redis.call('HDEL', KEYS[2], id)
  redis.call('HDEL', KEYS[3], id)
end
for _, id in ipairs(expired) do publish(id, '') end
local function renew()
  for i = 1, 3 do redis.call('PEXPIRE', KEYS[i], 90000) end
end
`;

export const joinScript = clockAndPrune + `
if redis.call('ZCARD', KEYS[1]) >= 250 then return 429 end
redis.call('HSET', KEYS[2], ARGV[1], cjson.encode({key = ARGV[2], lastUpdate = 0, lastSeen = 0}))
redis.call('ZADD', KEYS[1], now, ARGV[1])
renew()
publish(ARGV[1], '')
return 1
`;

export const updateCursorScript = clockAndPrune + `
local raw = redis.call('HGET', KEYS[2], ARGV[1])
if not raw then return 403 end
local session = cjson.decode(raw)
if session.key ~= ARGV[2] then return 403 end
if now - session.lastUpdate < 100 then return 429 end
session.lastUpdate = now
session.lastSeen = now
redis.call('HSET', KEYS[2], ARGV[1], cjson.encode(session))
redis.call('ZADD', KEYS[1], now, ARGV[1])
local old = redis.call('HGET', KEYS[3], ARGV[1]) or ''
if ARGV[3] == '' then redis.call('HDEL', KEYS[3], ARGV[1])
else redis.call('HSET', KEYS[3], ARGV[1], ARGV[3]) end
renew()
if old ~= ARGV[3] then publish(ARGV[1], ARGV[3]) end
return 1
`;

export const leaveScript = clockAndPrune + `
local raw = redis.call('HGET', KEYS[2], ARGV[1])
if not raw or cjson.decode(raw).key ~= ARGV[2] then return 0 end
redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('HDEL', KEYS[2], ARGV[1])
redis.call('HDEL', KEYS[3], ARGV[1])
publish(ARGV[1], '')
return 1
`;

export const snapshotScript = clockAndPrune + `
local alive = {}
for _, credentials in ipairs(cjson.decode(ARGV[1])) do
  local raw = redis.call('HGET', KEYS[2], credentials.id)
  if raw and cjson.decode(raw).key == credentials.key then
    redis.call('ZADD', KEYS[1], now, credentials.id)
    table.insert(alive, credentials.id)
  end
end
local cursors = redis.call('HKEYS', KEYS[3])
for _, id in ipairs(cursors) do
  local raw = redis.call('HGET', KEYS[2], id)
  if not raw or now - cjson.decode(raw).lastSeen > 20000 then
    redis.call('HDEL', KEYS[3], id)
    publish(id, '')
  end
end
renew()
return {tostring(redis.call('ZCARD', KEYS[1])), redis.call('HGETALL', KEYS[3]), alive}
`;
