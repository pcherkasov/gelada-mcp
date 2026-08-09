export class SecretRedactor {
  private secretsToRedact: Set<string> = new Set();
  private redactRegexes: RegExp[] = [];

  constructor() {
    // Default patterns for common secrets (e.g. AWS, GitHub, generic tokens)
    // Basic heuristics to catch common token formats
    this.redactRegexes = [
      // AWS Access Key ID
      /(?<![A-Z0-9])[A-Z0-9]{20}(?![A-Z0-9])/g,
      // AWS Secret Access Key (base64-like, length 40)
      /(?<![A-Za-z0-9/+=])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])/g,
      // GitHub Token (ghp_, github_pat_, etc)
      /gh[pousr]_[A-Za-z0-9_]{36,255}/g,
      // Generic Bearer/Token strings
      /(?:Bearer\s+|token\s+|Authorization:\s*)[a-zA-Z0-9._-]{20,}/gi,
    ];
  }

  /**
   * Add specific string values that should be redacted from output.
   * Typically extracted from environment variables.
   */
  public addSecretValues(values: string[]): void {
    for (const val of values) {
      if (val && val.length > 5) { // Only redact reasonably long strings to avoid false positives
        this.secretsToRedact.add(val);
      }
    }
  }

  /**
   * Add values from an environment object based on key matching.
   */
  public addSecretsFromEnv(env: Record<string, string | undefined>, sensitiveKeys: Set<string>, sensitivePatterns: RegExp[]): void {
    for (const [key, val] of Object.entries(env)) {
      if (!val) continue;
      const upperKey = key.toUpperCase();
      let isSensitive = sensitiveKeys.has(upperKey);
      
      if (!isSensitive) {
        for (const pattern of sensitivePatterns) {
          if (pattern.test(key)) {
            isSensitive = true;
            break;
          }
        }
      }

      if (isSensitive) {
        this.addSecretValues([val]);
      }
    }
  }

  /**
   * Redact secrets from a given text.
   */
  public redact(text: string): string {
    if (!text) return text;

    let redactedText = text;

    // 1. Redact explicit secret values
    for (const secret of this.secretsToRedact) {
      // Escape secret for regex
      const escapedSecret = secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escapedSecret, 'g');
      redactedText = redactedText.replace(regex, '[REDACTED]');
    }

    // 2. Redact using heuristic regexes
    for (const regex of this.redactRegexes) {
      redactedText = redactedText.replace(regex, '[REDACTED]');
    }

    return redactedText;
  }
}
