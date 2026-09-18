/** Accès à l'API HTTP. Les cookies de session partent d'eux-mêmes. */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly hint?: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: init.body ? { 'content-type': 'application/json' } : {},
    ...init,
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
      hint?: string;
    };
    throw new ApiError(res.status, body.error ?? 'ERROR', body.message ?? res.statusText, body.hint);
  }
  return (await res.json()) as T;
}

export const api = {
  get: <T,>(path: string) => request<T>(path),
  post: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T,>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T,>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  del: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: 'DELETE', body: body === undefined ? undefined : JSON.stringify(body) }),
};

export interface Me {
  id: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  /** `extra` est un sac ouvert de préférences ; l'étagère à jetons y vit. */
  prefs: { cardBackUrl: string | null; uiScale: number; extra?: Record<string, unknown> | null } | null;
  playmats: Array<{ id: string; name: string; imageUrl: string }>;
}

export interface CardMeta {
  scryfallId: string;
  name: string;
  setCode: string;
  collectorNumber: string;
  typeLine: string;
  manaCost: string | null;
  colorIdentity: string[];
  /** Couleurs réelles de la carte. Sépare deux jetons de même nom. */
  colors?: string[];
  layout: string;
  imageUris: { normal?: string; small?: string; large?: string } | null;
  faces: Array<{ name: string; imageUris: { normal?: string } | null }> | null;
  power?: string | null;
  toughness?: string | null;
  /**
   * Les mécaniques de la carte : `['Haste', 'Cascade']`, `['Discover']`, `[]`.
   *
   * Trois états, et les distinguer est tout l'intérêt : un tableau qui contient
   * le mot-clé, un tableau **vide** qui dit « cette carte n'en a aucun », et
   * `null`/absent qui dit « on ne sait pas » — ligne de catalogue jamais
   * ré-ingérée. L'interface met l'action en évidence sur le premier cas et ne
   * ferme jamais le chemin manuel sur les deux autres : ne pas savoir n'est pas
   * une raison de dire non.
   */
  keywords?: string[] | null;
}
