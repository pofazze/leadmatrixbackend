export type WaitProfile = '20-30' | '30-100' | '60-200';

export function getDelayRange(profile: WaitProfile): [number, number] {
  switch (profile) {
    case '20-30':
      return [20, 30];
    case '60-200':
      return [60, 200];
    case '30-100':
    default:
      return [30, 100];
  }
}

export function randomMsBetween(minSec: number, maxSec: number) {
  const min = Math.ceil(minSec * 1000);
  const max = Math.floor(maxSec * 1000);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function wait(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}
