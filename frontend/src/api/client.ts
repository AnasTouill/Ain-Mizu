import type {
  Actuation,
  AppConfig,
  BlockEdgeRequest,
  BlockEdgeResponse,
  CompareResponse,
  EnergyDay,
  FarmerSummary,
  FarmPlan,
  FieldWeekly,
  ModelMetrics,
  WeeklyPlan,
  FieldCollection,
  Kpis,
  NetworkResponse,
  PredictionRow,
  RecomputeRequest,
  RecomputeResponse,
  StatusType,
  Timeseries,
  ZoneInfo,
} from '../types';
import type { OnboardingOptions, SavedFarm, SourceSuggestion } from '../types';
import { useAuth, type AuthUser } from '../store/useAuth';

/** Error carrying the backend's `{ "detail": "message" }` and the HTTP status (0 = network error). */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  const token = useAuth.getState().token;
  const auth: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  try {
    res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...auth, ...(init?.headers ?? {}) } });
  } catch {
    throw new ApiError('network', 0);
  }
  if (res.status === 401 && token && !path.startsWith('/api/auth/login')) useAuth.getState().logout();
  if (!res.ok) {
    let detail = res.statusText || `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (typeof body?.detail === 'string') detail = body.detail;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(detail, res.status);
  }
  return (await res.json()) as T;
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

const post = <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) });

type AuthResponse = { access_token: string; token_type: string; expires_in: number; user: AuthUser };
type GeomBody = { zone: string; boundary: [number, number][]; sub_zones?: { name?: string; polygon: [number, number][]; crop?: string | null; soil?: string | null }[] };

export const api = {
  login: (email: string, password: string) => post<AuthResponse>('/api/auth/login', { email, password }),
  register: (name: string, email: string, password: string, language: string) => post<AuthResponse>('/api/auth/register', { name, email, password, language }),
  me: () => request<AuthUser>('/api/auth/me'),
  onboardingOptions: () => request<OnboardingOptions>('/api/onboarding/options'),
  autoSegment: (body: GeomBody) => post<{ segments: { field_id: string; polygon: [number, number][]; area_ha: number; stress_class: number | null }[] }>('/api/onboarding/auto-segment', body),
  suggestSource: (body: GeomBody) => post<SourceSuggestion>('/api/onboarding/suggest-source', body),
  createFarm: (body: unknown) => post<{ farm: SavedFarm; user: AuthUser }>('/api/farms', body),
  myFarms: () => request<SavedFarm[]>('/api/farms'),
  updateFarm: (farmId: string, body: unknown) => request<{ farm: SavedFarm; user: AuthUser }>(`/api/farms/${encodeURIComponent(farmId)}`, { method: 'PUT', body: JSON.stringify(body) }),
  farmStats: (farmId: string) => request<any>(`/api/farms/${encodeURIComponent(farmId)}/stats`), // eslint-disable-line @typescript-eslint/no-explicit-any
  control: (farmId: string) => request<any>(`/api/farms/${encodeURIComponent(farmId)}/control`), // eslint-disable-line @typescript-eslint/no-explicit-any
  controlPut: (farmId: string, path: string, body: unknown) => request<any>(`/api/farms/${encodeURIComponent(farmId)}/control/${path}`, { method: 'PUT', body: JSON.stringify(body) }), // eslint-disable-line @typescript-eslint/no-explicit-any
  controlLog: (farmId: string) => request<{ ts: string; user_id: string; action: string; detail: Record<string, unknown> }[]>(`/api/farms/${encodeURIComponent(farmId)}/control/log`),
  terrain: (zone: string, bbox: number[]) =>
    request<{ builtup: GeoJSON.FeatureCollection; water: GeoJSON.FeatureCollection; roads: GeoJSON.FeatureCollection; canals: GeoJSON.FeatureCollection; available: boolean }>(`/api/terrain/${zone}${qs({ bbox: bbox.join(',') })}`),
  modelMetrics: () => request<ModelMetrics>('/api/model/metrics'),
  modelPlan: (zone?: string) => request<WeeklyPlan>(`/api/model/plan${qs({ zone })}`),
  fieldWeekly: (fieldId: string, weeks = 104) => request<FieldWeekly>(`/api/model/fields/${encodeURIComponent(fieldId)}/weekly${qs({ weeks })}`),
  health: () => request<{ status: string }>('/api/health'),
  config: () => request<AppConfig>('/api/config'),
  zones: () => request<ZoneInfo[]>('/api/zones'),
  fields: (zone: string, month: string, status_type: StatusType) =>
    request<FieldCollection>(`/api/fields${qs({ zone, month, status_type })}`),
  timeseries: (fieldId: string, from?: string, to?: string) =>
    request<Timeseries>(`/api/fields/${encodeURIComponent(fieldId)}/timeseries${qs({ from, to })}`),
  predictions: (zone: string, month: string, status_type: StatusType, stress_class?: number) =>
    request<PredictionRow[]>(`/api/predictions${qs({ zone, month, status_type, stress_class })}`),
  network: (zone: string, month: string) => request<NetworkResponse>(`/api/network${qs({ zone, month })}`),
  recompute: (body: RecomputeRequest) => post<RecomputeResponse>('/api/network/recompute', body),
  blockEdge: (body: BlockEdgeRequest) => post<BlockEdgeResponse>('/api/network/block-edge', body),
  compare: (zone: string, month: string) => request<CompareResponse>(`/api/compare${qs({ zone, month })}`),
  energy: (zone: string, date: string) => request<EnergyDay>(`/api/energy${qs({ zone, date })}`),
  kpis: (zone: string, month: string) => request<Kpis>(`/api/kpis${qs({ zone, month })}`),
  farmers: () => request<FarmerSummary[]>('/api/farmers'),
  farmPlan: (farmerId: string, month: string, status_type: StatusType) =>
    request<FarmPlan>(`/api/farmers/${encodeURIComponent(farmerId)}/plan${qs({ month, status_type })}`),
  farmEdge: (farmerId: string, body: { month: string; status_type: StatusType; edge_id: string; blocked: boolean }) =>
    post<FarmPlan>(`/api/farmers/${encodeURIComponent(farmerId)}/edges`, body),
  toggleRoute: (farmerId: string, body: { month: string; status_type: StatusType; field_id: string; active: boolean }) =>
    post<FarmPlan>(`/api/farmers/${encodeURIComponent(farmerId)}/routes`, body),
  actuation: (zone: string, month: string, hour?: number) =>
    request<Actuation>(`/api/actuation${qs({ zone, month, hour })}`),
};
