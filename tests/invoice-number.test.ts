import { test } from "node:test";
import assert from "node:assert/strict";
import { invoiceNumber } from "../src/lib/invoiceNumber.ts";

test("PayPal invoice numbers stay within 25 characters and keep the unique stamp", () => {
  for (const [title, surname] of [["Fresno Tournament", "Garcia"], ["Season-end trophies and banquet", "Thompson-Whitaker"], ["Ref fees", "Lor"]]) {
    const n = invoiceNumber("HAWKS", title, surname, "UB8TW");
    assert.ok(n.length <= 25, `${n} is ${n.length}`);
    assert.ok(n.endsWith("-UB8TW"));
  }
  assert.equal(invoiceNumber("HAWKS", "Fresno Tournament", "Garcia", "UB8TW"), "HAWKS-FRESNO-GARCIA-UB8TW");
});
