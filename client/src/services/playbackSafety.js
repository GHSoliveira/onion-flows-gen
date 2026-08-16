let snapshot = Object.freeze({ activeCallCount: 0 });
const listeners = new Set();

export const getPlaybackSafetySnapshot = () => snapshot;

export const subscribePlaybackSafety = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const setGenesysActiveCallCount = (count) => {
  const nextCount = Math.max(0, Number(count) || 0);
  if (snapshot.activeCallCount === nextCount) return;
  snapshot = Object.freeze({ activeCallCount: nextCount });
  listeners.forEach((listener) => listener());
};

