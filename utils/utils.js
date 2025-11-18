function getTimeRemainingString(expiresAt) {
  const expiration = new Date(expiresAt);
  const now = new Date();
  const diffMs = expiration - now;

  if (diffMs <= 0) return 'Expired';

  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMinutes < 60) {
    return `in ${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''}`;
  } else if (diffHours < 24) {
    return `in ${diffHours} hour${diffHours !== 1 ? 's' : ''}`;
  } else {
    return `in ${diffDays} day${diffDays !== 1 ? 's' : ''}`;
  }
}


module.exports = { getTimeRemainingString };