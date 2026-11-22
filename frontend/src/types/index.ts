/**
 * TypeScript mirror of ARCHITECTURE.md section 13 (data files) and section 14 (API shapes).
 * Mock data and the real pipeline output share these schemas.
 */

export type ZoneId = 'kairouan' | 'sidi_bouzid' | 'kebili' | (string & {});
export type StressClass = 0 | 1 | 2 | 3; // 0 green, 1 yellow, 2 orange, 3 red
export type StatusType = 'current' | 'forecast';
export type ClassLabel = 'green' | 'yellow' | 'orange' | 'red';
export type Lang = 'fr' | 'en' | 'ar';

// ---------------------------------------------------------------- 13.9 config.json
export interface ZoneConfig {
  id: ZoneId;
  name: string;
  center: [number, number]; // [lon, lat]
}
export interface PhysarumParams {
  gamma: number;
  dt: number;
  max_iterations: number;
  tolerance: number;
  prune_threshold: number;
  initial_conductivity: number;
  flux_scale?: number;
}
export interface EnergyConfig {
  pump_kw: number;
  kwh_per_m3: number;
  pv_kwp: number;
  pv_performance_ratio: number;
  tank_capacity_m3: number;
  tank_initial_frac: number;
  station_share_of_demand: number;
  irrigation_hours: number[];
}
export interface AppConfig {
  zones: ZoneConfig[];
  months: { first_observed: string; last_observed: string; forecast_horizon: number };
  class_labels: ClassLabel[];
  class_colors: string[];
  demand_weights: Record<ClassLabel, number>;
  class_thresholds: { note: string; stress_score_cuts?: number[]; red_guard?: string };
  physarum: PhysarumParams;
  edge_cost: { slope_penalty_a: number; default_loss_rate: number; existing_canal_factor: number };
  energy?: EnergyConfig;
  ui?: { default_zone?: ZoneId; default_language?: Lang };
  data_source?: string;
  pipeline?: PipelineInfo;
}

// ---------------------------------------------------------------- 13.1 fields_{zone}.geojson
export interface FieldStaticProperties {
  field_id: string;
  zone: ZoneId;
  area_ha: number;
  centroid_lon: number;
  centroid_lat: number;
  is_irrigated: boolean;
  mean_slope_deg: number;
  elevation_m: number;
}

// ---------------------------------------------------------------- 13.2 / 13.3 / 13.4 tables
export interface FieldMonthlyRow {
  zone: ZoneId;
  field_id: string;
  month: string;
  ndvi: number;
  ndmi: number;
  mndwi: number;
  bsi: number;
  evi: number;
  str: number;
  cloud_frac: number;
  is_gap_filled: boolean;
}
export interface WeatherMonthlyRow {
  zone: ZoneId;
  month: string;
  rain_mm: number;
  temp_mean_c: number;
  temp_max_c: number;
  et0_mm: number;
  solar_kwh_m2_day: number;
}
export interface PredictionRow {
  zone: ZoneId;
  field_id: string;
  month: string;
  ndmi_obs: number | null;
  ndmi_pred: number | null;
  horizon: number;
  residual: number | null;
  anomaly_z: number | null;
  trend: number | null;
  ndvi_anomaly_z: number | null;
  stress_class: StressClass | null;
  stress_score: number | null;
  demand_score: number | null;
  status_type: StatusType;
}

// ---------------------------------------------------------------- 13.5 graph
export interface GraphNode {
  node_id: string;
  zone: ZoneId;
  type: 'source' | 'field' | 'junction';
  lon: number;
  lat: number;
  elevation_m: number;
  area_ha?: number;
  capacity_m3_day?: number;
}
export interface GraphEdge {
  edge_id: string;
  zone: ZoneId;
  from: string;
  to: string;
  length_m: number;
  uphill_slope: number;
  loss_rate: number;
  effective_length: number;
  is_existing_canal: boolean;
  blocked: boolean;
}

// ---------------------------------------------------------------- 13.6 network file
export interface NetworkMetrics {
  total_length_m: number;
  weighted_loss: number;
  fields_served: number;
  resilience_score: number;
}
export interface NetworkFile {
  zone: ZoneId;
  month: string;
  params: { gamma: number; dt: number; iterations: number; prune_threshold: number };
  demands: Record<string, number>;
  edges: { edge_id: string; flow: number; conductivity: number; kept: boolean }[];
  metrics: NetworkMetrics;
  baselines: {
    shortest_path: Omit<NetworkMetrics, 'fields_served'>;
    equal_split: { weighted_loss: number };
  };
}

// ---------------------------------------------------------------- 13.7 / 13.8
export interface EnergyHour {
  hour: number;
  solar_kw: number;
  pump_on: boolean;
  pump_kw: number;
  tank_level_m3: number;
}
export interface EnergyDay {
  zone: ZoneId;
  date: string;
  tank_capacity_m3: number;
  hours: EnergyHour[];
  summary: { solar_share_pct: number; grid_kwh: number; total_pumped_m3: number };
}
export interface Kpis {
  zone: ZoneId;
  month: string;
  fields_by_class: Record<ClassLabel, number>;
  hectares_by_class: Record<ClassLabel, number>;
  water_saved_pct_vs_equal_split: number;
  solar_share_pct: number;
  forecast_mae_ndmi: number | null;
}

// ---------------------------------------------------------------- section 14 API shapes
export interface ZoneInfo {
  id: ZoneId;
  name: string;
  center: [number, number];
  field_count: number;
  irrigated_count: number;
  first_month: string;
  last_month: string;
  forecast_months: string[];
  bbox: [number, number, number, number];
}

export interface FieldFeatureProps {
  field_id: string;
  area_ha: number;
  is_irrigated: boolean;
  stress_class: StressClass | null;
  stress_score: number | null;
  demand_score: number | null;
  ndmi_pred: number | null;
  ndmi_obs: number | null;
  status_type: StatusType;
  horizon: number;
}
export type PolygonGeometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };
export interface FieldFeature {
  type: 'Feature';
  geometry: PolygonGeometry;
  properties: FieldFeatureProps;
}
export interface FieldCollection {
  type: 'FeatureCollection';
  features: FieldFeature[];
}

export interface TimeseriesPoint {
  month: string;
  ndvi: number | null;
  ndmi_obs: number | null;
  ndmi_pred: number | null;
  stress_class: StressClass | null;
  status_type: StatusType;
}
export interface Timeseries {
  field_id: string;
  points: TimeseriesPoint[];
}

export interface SourcePoint {
  node_id: string;
  lon: number;
  lat: number;
  capacity_m3_day: number | null;
}
export interface EdgeProps {
  edge_id: string;
  flow: number; // share of the total inflow (geometry is oriented downstream)
  conductivity: number;
  kept: boolean;
  blocked: boolean;
  length_m: number;
}
export interface EdgeFeature {
  type: 'Feature';
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  properties: EdgeProps;
}
export interface NetworkResponse {
  zone: ZoneId;
  month: string;
  sources: SourcePoint[];
  edges: { type: 'FeatureCollection'; features: EdgeFeature[] };
  metrics: NetworkMetrics;
}
export interface RecomputeRequest {
  zone: ZoneId;
  month: string;
  params?: Partial<PhysarumParams>;
  demand_overrides?: Record<string, number | null>;
  reset?: boolean;
}
export interface RecomputeResponse extends NetworkResponse {
  iterations_used: number;
}
export interface BlockEdgeRequest {
  zone: ZoneId;
  month: string;
  edge_id: string;
  blocked: boolean;
}
export interface BlockEdgeResponse extends NetworkResponse {
  rerouted: boolean;
  iterations_used: number;
  fields_unserved: string[];
}
export interface PlanMetrics {
  total_length_m: number;
  weighted_loss: number;
  resilience_score: number;
}
export interface CompareResponse {
  physarum: PlanMetrics;
  shortest_path: PlanMetrics;
  equal_split: { weighted_loss: number };
  water_saved_pct_vs_equal_split: number;
}
// ---------------------------------------------------------------- farmer view
export interface FarmerSummary {
  farmer_id: string;
  name: string;
  zone: ZoneId;
  field_count: number;
  area_ha: number;
  fields_need_water: number;
}
export interface FarmFieldProps extends FieldFeatureProps {
  label: number;
  needs_water: boolean;
  route_active: boolean;
  reachable: boolean;
  need_m3_day: number;
  next_class: StressClass | null;
  name?: string;
  crop?: string;
  soil?: string;
}
export interface FarmFieldFeature {
  type: 'Feature';
  geometry: PolygonGeometry;
  properties: FarmFieldProps;
}
export interface RouteFeature extends EdgeFeature {
  properties: EdgeProps & { serves: string[] };
}
export interface FarmPlan {
  boundary?: [number, number][] | null;
  farm_scoped?: boolean;
  fields_unserved?: string[];
  terrain?: { available: boolean; elevation_min_m: number | null; elevation_max_m: number | null; route_length_m: number; route_road_crossings: number; route_on_existing_canals_m: number; route_max_uphill_pct: number } | null;
  farmer: { farmer_id: string; name: string; zone: ZoneId; field_ids: string[]; area_ha: number };
  month: string;
  status_type: StatusType;
  fields: { type: 'FeatureCollection'; features: FarmFieldFeature[] };
  routes: { type: 'FeatureCollection'; features: RouteFeature[] };
  sources: SourcePoint[];
  summary: {
    fields_total: number;
    fields_need_water: number;
    fields_watered: number;
    total_need_m3_day: number;
    irrigation_hours: number[];
    et0_mm_day: number;
  };
  bbox: number[];
}

export interface Actuation {
  pump: { on: boolean; power_kw: number; flow_m3_h: number };
  valves: { edge_id: string; open: boolean; opening_pct: number }[];
}

// ---------------------------------------------------------------- real model (/api/model/*)
export interface PipelineInfo {
  state_week: string;
  forecast_week: string;
  forecast_month_key: string;
  model: string;
  imported_at: string;
  sources_hypothetical?: boolean;
}
export interface Scores { mae: number; rmse: number; r2: number }
export interface ModelMetrics {
  n_train: number;
  n_test: number;
  lightgbm: Scores;
  persistence: Scores;
  seasonal: Scores;
  'drops_gt_0.05'?: { n: number; lightgbm: Scores; persistence: Scores };
  leave_one_zone_out?: Record<string, { lightgbm: Scores; persistence: Scores }>;
  stress_thresholds_z?: { jaune: number; orange: number; rouge: number };
  stress_train_distribution?: Record<string, number>;
  feature_importance: { feature: string; share: number }[];
  figures: string[];
}
export interface PlanRow {
  field_id: string;
  zone: ZoneId;
  area_ha: number;
  irrigated_summer: boolean;
  ndmi: number | null;
  pred_ndmi_next: number | null;
  z_now: number | null;
  z_next: number | null;
  class_now: StressClass | null;
  class_next: StressClass | null;
  et0_next_mm: number | null;
  rain_next_mm: number | null;
  demand_m3: number | null;
  state_week: string;
  days_since_obs: number;
}
export interface PlanZoneSummary {
  zone: ZoneId;
  fields: number;
  demand_m3: number;
  area_ha: number;
  class_now: Record<string, number>;
  class_next: Record<string, number>;
  worsening: number;
  improving: number;
}
export interface WeeklyPlan { forecast_week: string | null; zones: PlanZoneSummary[]; total_demand_m3: number; rows: PlanRow[] }
export interface WeeklyPoint {
  week: string;
  ndmi: number | null;
  ndmi_interp: number | null;
  ndmi_pred: number | null;
  ndvi: number | null;
  normal: number | null;
  sd: number | null;
  cls: StressClass | null;
  z: number | null;
  forecast: boolean;
}
export interface FieldWeekly {
  field_id: string;
  points: WeeklyPoint[];
  next: {
    week: string;
    pred_ndmi_next: number | null;
    z_next: number | null;
    class_now: StressClass | null;
    class_next: StressClass | null;
    demand_m3: number | null;
    et0_next_mm: number | null;
    rain_next_mm: number | null;
  } | null;
}

// ---------------------------------------------------------------- onboarding (/api/onboarding, /api/farms)
export type LonLat = [number, number];
export interface CropOption { id: string; category: string; fr: string; en: string; ar: string; need_mm: number }
export interface SoilOption { id: string; fr: string; en: string; ar: string; factor: number }
export interface LabelOption { id: string; fr: string; en: string; ar: string }
export interface OnboardingOptions {
  zones: { id: ZoneId; name: string; center: [number, number]; bbox: [number, number, number, number] }[];
  crops: CropOption[];
  categories: LabelOption[];
  soils: SoilOption[];
  source_types: LabelOption[];
}
export interface SubZoneDraft { key: string; name: string; polygon: LonLat[]; crop: string | null; soil: string | null; field_id?: string }
export interface SourceDraft { lon: number; lat: number; type: string; suggested?: boolean }
export interface SourceSuggestion {
  lon: number;
  lat: number;
  type: string;
  need_m3_year: number;
  pipe_length_m: number;
  pipe_length_center_m: number;
  mean_distance_m: number;
  mean_distance_center_m: number;
  saving_vs_center_pct: number;
  max_distance_m: number;
  sub_zones: { name: string | null; need_m3_year: number; stress_class_mean: number | null }[];
  method: string;
}
export interface SavedFarm {
  farm_id: string;
  name: string;
  zone: ZoneId;
  owner_user_id: string;
  field_ids: string[];
  area_ha: number;
  bounds: [[number, number], [number, number]];
  boundary: LonLat[];
  sub_zones: { sub_zone_id: string; name: string; polygon: LonLat[]; area_ha: number; category: string; crop: string; soil: string; need_m3_year: number }[];
  has_water_source: boolean;
  water_sources: { source_id: string; lon: number; lat: number; type: string; status: 'existing' | 'planned'; suggested: boolean }[];
  need_m3_year: number;
  created_at: string;
}
