import assert from "node:assert/strict";
import { summarize } from "./report.mjs";
assert.deepEqual(summarize([{ completed: 7 }, { completed: 11 }, { completed: 4 }]), { teams: 3, completed: 22 });
assert.deepEqual(summarize([]), { teams: 0, completed: 0 });
assert.throws(() => summarize([{ completed: -1 }]));
assert.throws(() => summarize([{ completed: "7" }]));
console.log("4 reporting checks passed");
