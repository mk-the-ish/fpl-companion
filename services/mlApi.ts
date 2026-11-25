import type {
  OptimizeSquadRequest,
  ModelStatusResponse,
  OptimizedSquadOutput,
  PositionRecommendation,
} from '../types/mlApi';

const API_TIMEOUT_MS = 8_000;

export interface MlAnalysisResult<T> {
  data: T;
  source: 'backend' | 'local';
  fallbackReason?: string;
}

export function getAnalysisSourceLabel(
  source: MlAnalysisResult<unknown>['source'],
  modelStatus?: ModelStatusResponse
): string {
  if (source === 'local') return 'Using local TypeScript engine.';
  if (modelStatus?.status === 'ready') {
    return `Using trained ML model${modelStatus.model_version ? ` (${modelStatus.model_version})` : ''}.`;
  }
  if (modelStatus?.status === 'loading') {
    return 'Backend connected; model is training, so server output may use its heuristic fallback.';
  }
  if (modelStatus?.status === 'untrained') {
    return 'Backend connected; no trained model is available, so server heuristics are active.';
  }
  return 'Using backend output; trained-model status is unavailable.';
}

export function normalizeMlApiBaseUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('Enter a valid server URL, such as http://192.168.1.10:8000.');
  }

  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('Use an HTTP or HTTPS server URL without credentials, query parameters, or a fragment.');
  }

  const path = url.pathname.replace(/\/+$/, '').replace(/\/api\/v1$/, '');
  return `${url.origin}${path}`;
}

export async function getModelStatus(
  baseUrl: string,
  signal?: AbortSignal
): Promise<ModelStatusResponse> {
  const status = await request<ModelStatusResponse>(baseUrl, '/model', {}, signal);
  if (
    !status ||
    !['ready', 'untrained', 'loading'].includes(status.status) ||
    (status.model_version !== null && typeof status.model_version !== 'string')
  ) {
    throw new Error('The ML API returned an invalid model status response.');
  }
  return status;
}

export function getMlApiErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'The ML API request failed.';
}

async function request<T>(
  baseUrl: string,
  path: string,
  options: RequestInit,
  externalSignal?: AbortSignal
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, API_TIMEOUT_MS);
  const abortFromQuery = () => controller.abort();
  externalSignal?.addEventListener('abort', abortFromQuery);

  try {
    const response = await fetch(`${baseUrl}/api/v1${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      let detail = `The ML API returned HTTP ${response.status}.`;
      try {
        const body = await response.json();
        const message = body?.error?.message;
        if (typeof message === 'string' && message.trim()) detail = message;
      } catch {
        // Keep the HTTP status as the useful error when the response is not JSON.
      }
      throw new Error(detail);
    }

    return (await response.json()) as T;
  } catch (error) {
    if (timedOut) {
      throw new Error('The ML API request timed out. Check that the server is running and reachable.');
    }
    if (externalSignal?.aborted) throw error;
    if (error instanceof Error && error.message) throw error;
    throw new Error('Could not reach the ML API server.');
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', abortFromQuery);
  }
}

export function optimizeSquad(
  baseUrl: string,
  payload: OptimizeSquadRequest,
  signal?: AbortSignal
): Promise<OptimizedSquadOutput> {
  return request<OptimizedSquadOutput>(
    baseUrl,
    '/optimize-squad',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    signal
  );
}

export function getRecommendations(
  baseUrl: string,
  startGameweek: number,
  position: 1 | 2 | 3 | 4,
  signal?: AbortSignal
): Promise<PositionRecommendation[]> {
  const query = new URLSearchParams({
    start_gw: String(startGameweek),
    position: String(position),
  });
  return request<PositionRecommendation[]>(
    baseUrl,
    `/recommendations?${query.toString()}`,
    {},
    signal
  );
}
