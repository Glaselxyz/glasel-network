import { test, expect } from "bun:test";
import { runConfidentialOrder } from "./confidential-order.js";

test("external-dev example: confidential notional round-trips", () => {
  expect(runConfidentialOrder({ price: 1000n, quantity: 7n })).toBe(7000n);
  expect(runConfidentialOrder({ price: 250n, quantity: 4n })).toBe(1000n);
  expect(runConfidentialOrder({ price: 1n, quantity: 1n })).toBe(1n);
});
