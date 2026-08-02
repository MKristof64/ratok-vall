import assert from "node:assert/strict";
import test from "node:test";
import { shuffleWithSeed } from "../lib/random-order.ts";

const participants = [
  { id: "anna", name: "Anna" },
  { id: "bela", name: "Béla" },
  { id: "csilla", name: "Csilla" },
  { id: "dani", name: "Dani" },
  { id: "emma", name: "Emma" },
];

test("the randomized target order is stable for the same seed", () => {
  assert.deepEqual(
    shuffleWithSeed(participants, 20260802),
    shuffleWithSeed(participants, 20260802),
  );
});

test("target shuffling preserves every participant and the original list", () => {
  const original = structuredClone(participants);
  const shuffled = shuffleWithSeed(participants, 42);

  assert.deepEqual(participants, original);
  assert.notStrictEqual(shuffled, participants);
  assert.deepEqual(
    shuffled.map(({ id, name }) => `${id}:${name}`).sort(),
    participants.map(({ id, name }) => `${id}:${name}`).sort(),
  );
});

test("new seeds can produce new target orders", () => {
  const permutations = new Set(
    Array.from({ length: 12 }, (_, seed) =>
      shuffleWithSeed(participants, seed).map(({ id }) => id).join(","),
    ),
  );

  assert.ok(permutations.size > 1);
  assert.deepEqual(shuffleWithSeed([], 1), []);
  assert.deepEqual(shuffleWithSeed(participants.slice(0, 1), 1), participants.slice(0, 1));
});
