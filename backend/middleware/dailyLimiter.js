// Simple in-memory per-IP daily limiter. Resets at local midnight.

const dailyCounts = new Map(); // ip -> { count, dateKey }

function todayKey() {
  return new Date().toDateString();
}

function getDailyRemaining(ip, dailyLimit) {
  const entry = dailyCounts.get(ip);
  const key = todayKey();
  if (!entry || entry.dateKey !== key) return dailyLimit;
  return Math.max(0, dailyLimit - entry.count);
}

function dailyLimiter(dailyLimit) {
  return function (req, res, next) {
    const ip = req.ip;
    const key = todayKey();
    let entry = dailyCounts.get(ip);

    if (!entry || entry.dateKey !== key) {
      entry = { count: 0, dateKey: key };
      dailyCounts.set(ip, entry);
    }

    if (entry.count >= dailyLimit) {
      return res.status(429).json({
        error: 'Daily limit reached. Please try again tomorrow.',
        retryAfter: 'tomorrow',
      });
    }

    entry.count += 1;
    req.dailyRemaining = Math.max(0, dailyLimit - entry.count);
    next();
  };
}

// Cleanup stale entries once a day.
setInterval(() => {
  const key = todayKey();
  for (const [ip, entry] of dailyCounts.entries()) {
    if (entry.dateKey !== key) dailyCounts.delete(ip);
  }
}, 60 * 60 * 1000);

module.exports = { dailyLimiter, getDailyRemaining, dailyCounts };
