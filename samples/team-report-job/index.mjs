import { readFileSync, writeFileSync } from "node:fs";
import { summarize } from "./report.mjs";
const result = summarize(JSON.parse(readFileSync("activity.json", "utf8")));
const report = `Team activity report\nTeams: ${result.teams}\nCompleted tasks: ${result.completed}\n`;
writeFileSync("report.txt", report);
console.log(report);
