export function summarize(rows) {
  if (!Array.isArray(rows) || rows.some((row) => !Number.isInteger(row.completed) || row.completed < 0)) {
    throw new Error("Each activity row must have a non-negative integer completed count");
  }
  return { teams: rows.length, completed: rows.reduce((total, row) => total + row.completed, 0) };
}
