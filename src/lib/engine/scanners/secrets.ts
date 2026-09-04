import type { Finding } from "../types";

/**
 * Secret scanning: gitleaks-inspired pattern subset (RE2-compatible constructs
 * translate 1:1) plus Shannon-entropy gate for generic assignments.
 * Precision of generic rules is intentionally modest (~46% in gitleaks'
 * published benchmarks); the review UI treats findings as triage items, but
 * pattern hits are hard blocks.
 */

interface Rule {
  key: string;
  title: string;
  pattern: RegExp;
  severity: "critical" | "warn";
  /** 1-based capture group whose value is checked against the entropy gate */
  entropyGroup?: number;
}

/** Structural template markers always indicate non-secrets. */
const STRUCTURAL_ALLOWLIST = /\$\{|\$\(|%s|%d|<%[=~-]?|<[A-Z_]{3,}>|\bxxxxx+\b/;
/**
 * Placeholder words suppress only the GENERIC entropy rule. Specific
 * high-confidence patterns (AWS/GitHub/Slack/...) bypass it: a string shaped
 * exactly like an AWS key should surface even if it contains "example",
 * because rotation costs minutes and an ignored leak costs weeks.
 */
const WORD_PLACEHOLDER = /your[-_]|example|placeholder|changeme|change-me|dummy|sample|redacted|process\.env/i;

const RULES: Rule[] = [
  {
    key: "aws-access-key",
    title: "AWS access key ID",
    pattern: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g,
    severity: "critical",
  },
  {
    key: "github-token",
    title: "GitHub token",
    pattern: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g,
    severity: "critical",
  },
  {
    key: "slack-token",
    title: "Slack token",
    pattern: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g,
    severity: "critical",
  },
  {
    key: "google-api-key",
    title: "Google API key",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    severity: "critical",
  },
  {
    key: "stripe-secret-key",
    title: "Stripe live secret key",
    pattern: /\bsk_live_[0-9a-zA-Z]{24,}\b/g,
    severity: "critical",
  },
  {
    key: "private-key-block",
    title: "Private key material embedded in source",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY( BLOCK)?-----/g,
    severity: "critical",
  },
  {
    key: "jwt-literal",
    title: "Hardcoded JWT",
    pattern: /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{5,}\b/g,
    severity: "warn",
  },
  {
    key: "generic-secret-assignment",
    title: "High-entropy value assigned to secret-named variable",
    // RE2-compatible: keyword = "value"  (single or double quoted)
    pattern: /(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key)\s*["']?\s*[=:]\s*["']([A-Za-z0-9_\-+/=.]{12,})["']/gi,
    severity: "warn",
    entropyGroup: 1,
  },
];

export function shannonEntropy(s: string): number {
  if (!s.length) return 0;
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const count of freq.values()) {
    const p = count / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

const ENTROPY_THRESHOLD = 3.5;

function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) if (content[i] === "\n") line++;
  return line;
}

function redact(value: string): string {
  return value.length <= 6 ? "…" : `${value.slice(0, 4)}…(${value.length} chars)`;
}

export interface ScannedFile {
  path: string;
  content: string;
}

const SKIP_PATHS = /(^|\/)(node_modules|\.git|dist|build|coverage)(\/|$)/;

export function scanForSecrets(files: ScannedFile[]): Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    if (SKIP_PATHS.test(file.path)) continue;
    /** spans already matched by specific rules; generic rule defers to them */
    const claimedSpans: Array<[number, number]> = [];
    const overlapsClaimed = (start: number, end: number): boolean =>
      claimedSpans.some(([s, e]) => start < e && end > s);
    // pass 1: specific patterns claim spans
    const genericRule = RULES.find((r) => r.key === "generic-secret-assignment")!;
    const specificRules = RULES.filter((r) => r !== genericRule);
    for (const rule of specificRules) {
      rule.pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = rule.pattern.exec(file.content)) !== null) {
        claimedSpans.push([m.index, m.index + m[0].length]);
        pushFinding(rule, m[0], m.index);
      }
    }
    // pass 2: generic assignments (entropy-gated, placeholder-suppressed)
    genericRule.pattern.lastIndex = 0;
    let gm: RegExpExecArray | null;
    while ((gm = genericRule.pattern.exec(file.content)) !== null) {
      const valueStart = gm.index + gm[0].indexOf(gm[1]);
      if (overlapsClaimed(valueStart, valueStart + gm[1].length)) continue;
      pushFinding(genericRule, gm[1], valueStart);
    }

    function pushFinding(rule: Rule, matchedValue: string, index: number): void {
      if (STRUCTURAL_ALLOWLIST.test(matchedValue)) return;
      if (rule === genericRule) {
        if (WORD_PLACEHOLDER.test(matchedValue)) return;
        if (shannonEntropy(matchedValue) < ENTROPY_THRESHOLD) return;
      }
      const line = lineOf(file.content, index);
      findings.push({
        key: `secret-${rule.key}`,
        title: rule.title,
        status: rule.severity === "critical" ? "fail" : "warn",
        severity: rule.severity,
        details:
          `${rule.title} detected. Value redacted: ${redact(matchedValue)}. ` +
          (rule.severity === "critical"
            ? "Hard block: remove the secret, rotate it at the source, and load it via platform-minted credentials instead."
            : "Review required: confirm whether this token is sensitive."),
        evidence: [`${file.path}:${line}`],
      });
    }
  }
  return findings;
}
