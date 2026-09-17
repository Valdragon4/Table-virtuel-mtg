/**
 * Clients HTTP sortants. Chaque service tiers a sa file, son espacement minimal
 * et son User-Agent explicite : on ne tape jamais un tiers sans s'annoncer.
 */

export class RateLimitedFetcher {
  private queue: Promise<unknown> = Promise.resolve();
  private lastAt = 0;

  /**
   * `attempts` vaut 4 par défaut. Un service dont l'accès est accordé à titre de
   * faveur mérite `1` : on ne réessaie pas d'insister auprès de quelqu'un qui
   * vient de dire non.
   */
  constructor(
    private readonly minIntervalMs: number,
    private readonly headers: Record<string, string>,
    private readonly attempts = 4,
  ) {}

  /** Sérialise les appels et garantit `minIntervalMs` entre deux départs. */
  run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      const wait = this.lastAt + this.minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.lastAt = Date.now();
      return task();
    });
    // La file ne doit pas se rompre sur un échec d'appel.
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async json<T>(url: string, init: RequestInit = {}): Promise<T> {
    return this.run(async () => {
      const res = await fetchWithRetry(
        url,
        { ...init, headers: { ...this.headers, ...(init.headers as Record<string, string> | undefined) } },
        this.attempts,
      );
      return (await res.json()) as T;
    });
  }

  async raw(url: string, init: RequestInit = {}): Promise<Response> {
    return this.run(() =>
      fetchWithRetry(
        url,
        { ...init, headers: { ...this.headers, ...(init.headers as Record<string, string> | undefined) } },
        this.attempts,
      ),
    );
  }
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    message: string,
    readonly body?: string,
    /** `Retry-After` tel que reçu, quand le serveur en a envoyé un. */
    readonly retryAfter?: string | null,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Backoff exponentiel sur 429 et 5xx. `Retry-After` est respecté quand il est
 * présent : c'est la façon polie de se faire limiter.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  attempts = 4,
): Promise<Response> {
  let delay = 500;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;

      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt === attempts) {
        const body = await res.text().catch(() => '');
        throw new HttpError(
          res.status,
          url,
          `${res.status} ${res.statusText} sur ${url}`,
          body.slice(0, 500),
          res.headers.get('retry-after'),
        );
      }
      const retryAfter = Number.parseInt(res.headers.get('retry-after') ?? '', 10);
      await sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : delay);
      delay *= 2;
    } catch (err) {
      if (err instanceof HttpError) throw err;
      lastError = err;
      if (attempt === attempts) break;
      await sleep(delay);
      delay *= 2;
    }
  }
  throw new HttpError(0, url, `Échec réseau sur ${url}`, String(lastError));
}
