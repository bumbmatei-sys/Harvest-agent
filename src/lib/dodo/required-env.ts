/**
 * Required-environment reader for the Dodo billing module.
 *
 * SIDE-EFFECT FREE ON PURPOSE. Importing this file reads nothing and throws
 * nothing; only calling `requireDodoEnv` does. `config.ts` calls it at module
 * scope so a misconfigured deployment fails loudly at load, while the webhook
 * route calls it inside its handler (see the note there) so a variable that is
 * not set yet cannot break `next build`.
 *
 * ⚠️ THERE IS NO FALLBACK, AND THERE MUST NEVER BE ONE. `billing.ts` reads its
 * Stripe price IDs as `process.env.X ?? 'price_<a test id>'`, which is why a
 * deployment missing its live IDs quietly charges against test-mode prices
 * instead of failing. Test-versus-live confusion has already cost this project a
 * week. A missing variable on the money path is a deployment error, not a
 * default: it throws here, at startup, where it is one line in a build log
 * rather than a wrong charge on a church's card.
 */

/** Thrown when a variable the billing module cannot work without is absent. */
export class MissingDodoEnvError extends Error {
  readonly variable: string;

  constructor(variable: string, hint?: string) {
    super(
      `Missing required environment variable ${variable}. ` +
        `Dodo subscription billing cannot start without it${hint ? ` — ${hint}` : ''}. ` +
        `There is intentionally no fallback value: a default here would bill against the wrong catalogue.`,
    );
    this.name = 'MissingDodoEnvError';
    this.variable = variable;
  }
}

/**
 * Read a variable that must be present, or throw.
 *
 * An empty or whitespace-only value counts as missing — an env var set to `""`
 * in a dashboard is a configuration mistake, not a deliberate empty API key.
 */
export function requireDodoEnv(variable: string, hint?: string): string {
  const value = process.env[variable];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new MissingDodoEnvError(variable, hint);
  }
  return value.trim();
}
