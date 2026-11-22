import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BlockEdgeRequest, NetworkResponse, RecomputeRequest, StatusType } from '../types';
import { api } from './client';

export const qk = {
  config: ['config'] as const,
  zones: ['zones'] as const,
  fields: (zone: string, month: string, status: StatusType) => ['fields', zone, month, status] as const,
  timeseries: (id: string) => ['timeseries', id] as const,
  network: (zone: string, month: string) => ['network', zone, month] as const,
  compare: (zone: string, month: string) => ['compare', zone, month] as const,
  kpis: (zone: string, month: string) => ['kpis', zone, month] as const,
  energy: (zone: string, date: string) => ['energy', zone, date] as const,
  actuation: (zone: string, month: string, hour: number) => ['actuation', zone, month, hour] as const,
};

export const useConfig = () => useQuery({ queryKey: qk.config, queryFn: api.config, staleTime: Infinity });
export const useZones = () => useQuery({ queryKey: qk.zones, queryFn: api.zones, staleTime: Infinity });

export const useFields = (zone: string, month: string, status: StatusType) =>
  useQuery({
    queryKey: qk.fields(zone, month, status),
    queryFn: () => api.fields(zone, month, status),
    enabled: Boolean(zone && month),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });

export const useTimeseries = (fieldId: string | null) =>
  useQuery({
    queryKey: qk.timeseries(fieldId ?? ''),
    queryFn: () => api.timeseries(fieldId as string),
    enabled: Boolean(fieldId),
    staleTime: 5 * 60_000,
  });

export const useNetwork = (zone: string, month: string, enabled = true) =>
  useQuery({
    queryKey: qk.network(zone, month),
    queryFn: () => api.network(zone, month),
    enabled: enabled && Boolean(zone && month),
    placeholderData: keepPreviousData,
  });

export const useCompare = (zone: string, month: string) =>
  useQuery({ queryKey: qk.compare(zone, month), queryFn: () => api.compare(zone, month), enabled: Boolean(zone && month) });

export const useKpis = (zone: string, month: string) =>
  useQuery({
    queryKey: qk.kpis(zone, month),
    queryFn: () => api.kpis(zone, month),
    enabled: Boolean(zone && month),
    placeholderData: keepPreviousData,
  });

export const useEnergy = (zone: string, date: string) =>
  useQuery({
    queryKey: qk.energy(zone, date),
    queryFn: () => api.energy(zone, date),
    enabled: Boolean(zone && date),
    placeholderData: keepPreviousData,
    staleTime: 10 * 60_000,
  });

export const useActuation = (zone: string, month: string, hour: number) =>
  useQuery({
    queryKey: qk.actuation(zone, month, hour),
    queryFn: () => api.actuation(zone, month, hour),
    enabled: Boolean(zone && month),
    placeholderData: keepPreviousData,
  });

export const useFarmers = () => useQuery({ queryKey: ['farmers'], queryFn: api.farmers, staleTime: 5 * 60_000 });

export const useFarmPlan = (farmerId: string | null, month: string, status: StatusType) =>
  useQuery({
    queryKey: ['farm', farmerId, month, status],
    queryFn: () => api.farmPlan(farmerId as string, month, status),
    enabled: Boolean(farmerId && month),
    placeholderData: keepPreviousData,
  });

/** Close / reopen a canal of an onboarded farm (farm-scoped network). */
export function useFarmEdge(farmerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { month: string; status_type: StatusType; edge_id: string; blocked: boolean }) => api.farmEdge(farmerId, body),
    onSuccess: (plan, vars) => qc.setQueryData(['farm', farmerId, vars.month, vars.status_type], plan),
  });
}

/** Switch one parcel's water route on/off; the zone network changes, so zone views refresh too. */
export function useToggleRoute(farmerId: string, zone: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { month: string; status_type: StatusType; field_id: string; active: boolean }) => api.toggleRoute(farmerId, body),
    onSuccess: (plan, vars) => {
      qc.setQueryData(['farm', farmerId, vars.month, vars.status_type], plan);
      for (const key of ['network', 'compare', 'kpis', 'actuation']) qc.invalidateQueries({ queryKey: [key, zone, vars.month] });
      qc.invalidateQueries({ queryKey: ['farm'], predicate: (q) => q.queryKey[1] !== farmerId });
    },
  });
}

/** Anything derived from the network plan must refresh after a what-if change. */
function useInvalidatePlan() {
  const qc = useQueryClient();
  return (zone: string, month: string, network: NetworkResponse) => {
    const { zone: z, month: m, sources, edges, metrics } = network;
    qc.setQueryData(qk.network(zone, month), { zone: z, month: m, sources, edges, metrics });
    for (const key of ['compare', 'kpis', 'actuation']) qc.invalidateQueries({ queryKey: [key, zone, month] });
    qc.invalidateQueries({ queryKey: ['farm'] });
  };
}

export function useBlockEdge() {
  const refresh = useInvalidatePlan();
  return useMutation({
    mutationFn: (body: BlockEdgeRequest) => api.blockEdge(body),
    onSuccess: (data, vars) => refresh(vars.zone, vars.month, data),
  });
}

export function useRecompute() {
  const refresh = useInvalidatePlan();
  return useMutation({
    mutationFn: (body: RecomputeRequest) => api.recompute(body),
    onSuccess: (data, vars) => refresh(vars.zone, vars.month, data),
  });
}

// ---------------------------------------------------------------- real model (weekly LightGBM)
export const useModelMetrics = (enabled = true) =>
  useQuery({ queryKey: ['model', 'metrics'], queryFn: api.modelMetrics, staleTime: 10 * 60_000, enabled });

export const useModelPlan = (zone?: string, enabled = true) =>
  useQuery({ queryKey: ['model', 'plan', zone ?? 'all'], queryFn: () => api.modelPlan(zone), staleTime: 10 * 60_000, enabled, placeholderData: keepPreviousData });

export const useFieldWeekly = (fieldId: string | null, enabled = true) =>
  useQuery({
    queryKey: ['model', 'weekly', fieldId ?? ''],
    queryFn: () => api.fieldWeekly(fieldId as string),
    enabled: enabled && Boolean(fieldId),
    staleTime: 10 * 60_000,
    retry: false,
  });
