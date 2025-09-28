--[[
Atomic admission logic for Redis
Handles capacity checks, active session validation, and queue decisions

KEYS[1] = session:char:{characterId}       -- Character session lookup
KEYS[2] = session:instance:{instanceId}    -- Instance active sessions set
KEYS[3] = queue:{instanceId}              -- Instance queue sorted set
KEYS[4] = session:id:{sessionId}          -- New session storage
KEYS[5] = queue:entry:{characterId}       -- Queue entry data
KEYS[6] = ratelimit:lock:{userId}         -- Rate limit lockout check

ARGV[1] = characterId
ARGV[2] = userId  
ARGV[3] = instanceId
ARGV[4] = sessionId
ARGV[5] = now (timestamp)
ARGV[6] = maxCapacity
ARGV[7] = maxQueueSize
ARGV[8] = sessionData (JSON)
ARGV[9] = queueEntryData (JSON)
ARGV[10] = sessionTTL
ARGV[11] = queueEntryTTL
ARGV[12] = allowReplacement (0 or 1)

Returns:
  {outcome, failureReason, sessionData, queuePosition, queueDepth}
  outcome: "success", "queued", "failed" 
  failureReason: nil or reason string
  sessionData: nil or session JSON
  queuePosition: nil or 0-based position
  queueDepth: current queue size
--]]

local characterKey = KEYS[1]
local instanceSetKey = KEYS[2] 
local queueKey = KEYS[3]
local sessionKey = KEYS[4]
local queueEntryKey = KEYS[5]
local rateLimitKey = KEYS[6]

local characterId = ARGV[1]
local userId = ARGV[2]
local instanceId = ARGV[3]
local sessionId = ARGV[4]
local now = tonumber(ARGV[5])
local maxCapacity = tonumber(ARGV[6])
local maxQueueSize = tonumber(ARGV[7])
local sessionData = ARGV[8]
local queueEntryData = ARGV[9]
local sessionTTL = tonumber(ARGV[10])
local queueEntryTTL = tonumber(ARGV[11])
local allowReplacement = tonumber(ARGV[12])

-- Check rate limiting first
local rateLimited = redis.call('EXISTS', rateLimitKey)
if rateLimited == 1 then
  local lockoutExpiry = redis.call('GET', rateLimitKey)
  if lockoutExpiry and tonumber(lockoutExpiry) > (now / 1000) then
    return {"failed", "RATE_LIMITED", nil, nil, 0}
  end
end

-- Check for existing session
local existingSessionId = redis.call('GET', characterKey)
if existingSessionId then
  local existingSession = redis.call('GET', 'session:id:' .. existingSessionId)
  if existingSession then
    local sessionObj = cjson.decode(existingSession)
    -- If session is not terminating and replacement not allowed
    if sessionObj.state ~= 'terminating' and allowReplacement == 0 then
      return {"failed", "ALREADY_IN_SESSION", existingSession, nil, 0}
    end
    -- If replacement allowed but existing session is active, require confirmation
    if sessionObj.state == 'active' and allowReplacement == 1 then
      return {"failed", "ALREADY_IN_SESSION", existingSession, nil, 0}
    end
  end
end

-- Check current instance capacity
local currentSessions = redis.call('SCARD', instanceSetKey)
local currentQueue = redis.call('ZCARD', queueKey)

-- If capacity available, admit immediately
if currentSessions < maxCapacity then
  -- Remove from queue if character was queued
  local wasQueued = redis.call('ZSCORE', queueKey, characterId)
  if wasQueued then
    redis.call('ZREM', queueKey, characterId)
    redis.call('DEL', queueEntryKey)
  end
  
  -- Create session atomically
  redis.call('SET', sessionKey, sessionData, 'EX', sessionTTL)
  redis.call('SET', characterKey, sessionId, 'EX', sessionTTL)
  redis.call('SADD', instanceSetKey, sessionId)
  
  -- Set expiry on instance set key to prevent orphaning
  redis.call('EXPIRE', instanceSetKey, sessionTTL)
  
  return {"success", nil, sessionData, nil, currentQueue}
end

-- Capacity full, check if we can queue
if currentQueue >= maxQueueSize then
  return {"failed", "QUEUE_FULL", nil, nil, currentQueue}
end

-- Check if character already in queue
local existingQueueScore = redis.call('ZSCORE', queueKey, characterId)
if existingQueueScore then
  -- Return existing position
  local position = redis.call('ZRANK', queueKey, characterId)
  return {"queued", nil, nil, position, currentQueue}
end

-- Add to queue
redis.call('ZADD', queueKey, now, characterId)
redis.call('SET', queueEntryKey, queueEntryData, 'EX', queueEntryTTL)

-- Get new queue position  
local position = redis.call('ZRANK', queueKey, characterId)
local newQueueDepth = redis.call('ZCARD', queueKey)

return {"queued", nil, nil, position, newQueueDepth}