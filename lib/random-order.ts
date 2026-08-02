const UINT32_RANGE = 0x1_0000_0000;

export function createRandomSeed() {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const value = new Uint32Array(1);
    crypto.getRandomValues(value);
    return value[0];
  }

  return Math.floor(Math.random() * UINT32_RANGE);
}

export function shuffleWithSeed<T>(items: readonly T[], seed: number) {
  const shuffled = [...items];
  let state = seed >>> 0;

  const nextRandom = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / UINT32_RANGE;
  };

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const targetIndex = Math.floor(nextRandom() * (index + 1));
    [shuffled[index], shuffled[targetIndex]] = [shuffled[targetIndex], shuffled[index]];
  }

  return shuffled;
}
