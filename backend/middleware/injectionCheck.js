const INJECTION_PATTERNS = [
  /ignore\s+(previous|above|all)\s+instructions?/i,
  /forget\s+(everything|instructions?)/i,
  /you\s+are\s+now/i,
  /act\s+as\s+(a\s+)?different/i,
  /jailbreak/i,
  /DAN\s+mode/i,
  /system\s+prompt/i,
  /reveal\s+your\s+instructions?/i,
  /pretend\s+you\s+are/i,
  /override\s+instructions?/i,
  /\[INST\]/i,
  /<\|im_start\|>/i,
];

const OFF_TOPIC_PATTERNS = [
  /\brecipe\b/i,
  /\bmovie\b|\bfilm\b/i,
  /\bcrypto\b|\bbitcoin\b/i,
  /\b(write|debug)\s+(code|a\s+function|a\s+script)\b/i,
  /\bpoem\b/i,
  /\bweather\b/i,
  /\bjoke\b/i,
];

function checkInjection(message) {
  return INJECTION_PATTERNS.some((pattern) => pattern.test(message));
}

function checkOffTopic(message) {
  return OFF_TOPIC_PATTERNS.some((pattern) => pattern.test(message));
}

module.exports = { checkInjection, checkOffTopic, INJECTION_PATTERNS, OFF_TOPIC_PATTERNS };
