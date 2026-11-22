import { Grid, Html, OrbitControls, Sparkles } from '@react-three/drei';
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { makeProjector, outerRings, ringCentroid } from '../../lib/geo';
import type { FieldCollection, FieldFeature, NetworkResponse } from '../../types';
import { NA_COLOR } from '../ClassIcon';

type Projector = (lon: number, lat: number) => [number, number];

/* ------------------------------------------------------------------ fields: extruded prisms */

function Field3D({
  feature,
  project,
  color,
  height,
  selected,
  onSelect,
  onHover,
}: {
  feature: FieldFeature;
  project: Projector;
  color: string;
  height: number;
  selected: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  const id = feature.properties.field_id;
  const mesh = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const geometry = useMemo(() => {
    const ring = outerRings(feature.geometry)[0] ?? [];
    // shape in (east, north); rotating -90° about X maps north to -z and extrudes upwards
    const shape = new THREE.Shape(ring.map(([lon, lat]) => {
      const [x, z] = project(lon, lat);
      return new THREE.Vector2(x, -z);
    }));
    return new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
    // geometry depends only on the field outline
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, project]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const target = useMemo(() => new THREE.Color(color), [color]);

  useFrame((_, dt) => {
    const k = Math.min(1, dt * 4);
    if (mesh.current) mesh.current.scale.z += (height - mesh.current.scale.z) * k;
    mat.current?.color.lerp(target, k);
  });

  return (
    <mesh
      ref={mesh}
      geometry={geometry}
      rotation={[-Math.PI / 2, 0, 0]}
      scale={[1, 1, 0.05]}
      castShadow
      receiveShadow
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        onSelect(id);
      }}
      onPointerOver={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        onHover(id);
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        onHover(null);
        document.body.style.cursor = '';
      }}
    >
      <meshStandardMaterial
        ref={mat}
        color={color}
        roughness={0.78}
        metalness={0.04}
        emissive={selected ? '#1f8096' : color}
        emissiveIntensity={selected ? 0.4 : 0.05}
      />
    </mesh>
  );
}

/* ------------------------------------------------------------------ network: glowing tubes + flowing particles */

interface Tube {
  id: string;
  curve: THREE.QuadraticBezierCurve3;
  flow: number;
  conductivity: number;
  length: number;
}

function Particles({ tubes }: { tubes: Tube[] }) {
  const N = 520;
  const ref = useRef<THREE.InstancedMesh>(null);
  const state = useMemo(() => {
    const w = tubes.map((t) => Math.max(t.flow, 0.004));
    const total = w.reduce((a, b) => a + b, 0);
    const idx = new Int32Array(N);
    const phase = new Float32Array(N);
    const speed = new Float32Array(N);
    let cum = 0;
    let j = 0;
    for (let i = 0; i < N; i++) {
      const r = ((i + 0.5) / N) * total;
      while (j < w.length - 1 && cum + w[j] < r) cum += w[j++];
      idx[i] = j;
      phase[i] = (i * 0.61803) % 1;
      speed[i] = (1.2 + 5 * Math.sqrt(tubes[j]?.flow ?? 0)) / Math.max(tubes[j]?.length ?? 1, 0.5);
    }
    return { idx, phase, speed };
  }, [tubes]);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const p = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dt) => {
    const m = ref.current;
    if (!m || !tubes.length) return;
    for (let i = 0; i < N; i++) {
      state.phase[i] = (state.phase[i] + dt * state.speed[i]) % 1;
      tubes[state.idx[i]].curve.getPoint(state.phase[i], p);
      dummy.position.set(p.x, p.y + 0.12, p.z);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });
  if (!tubes.length) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, N]}>
      <sphereGeometry args={[0.13, 8, 8]} />
      <meshBasicMaterial color="#effafc" toneMapped={false} />
    </instancedMesh>
  );
}

function Network3D({ network, project }: { network: NetworkResponse; project: Projector }) {
  const tubes = useMemo<Tube[]>(
    () =>
      network.edges.features
        .filter((f) => f.properties.kept)
        .map((f) => {
          const [a, b] = f.geometry.coordinates;
          const [x1, z1] = project(a[0], a[1]);
          const [x2, z2] = project(b[0], b[1]);
          const length = Math.hypot(x2 - x1, z2 - z1);
          const mid = new THREE.Vector3((x1 + x2) / 2, 0.35 + length * 0.05, (z1 + z2) / 2);
          return {
            id: f.properties.edge_id,
            curve: new THREE.QuadraticBezierCurve3(new THREE.Vector3(x1, 0.25, z1), mid, new THREE.Vector3(x2, 0.25, z2)),
            flow: f.properties.flow,
            conductivity: f.properties.conductivity,
            length,
          };
        }),
    [network, project],
  );
  const blocked = useMemo(
    () =>
      network.edges.features
        .filter((f) => f.properties.blocked)
        .map((f) => {
          const [a, b] = f.geometry.coordinates;
          const [x1, z1] = project(a[0], a[1]);
          const [x2, z2] = project(b[0], b[1]);
          return { id: f.properties.edge_id, pos: new THREE.Vector3((x1 + x2) / 2, 0.6, (z1 + z2) / 2) };
        }),
    [network, project],
  );
  return (
    <group>
      {tubes.map((t) => (
        <mesh key={t.id} castShadow>
          <tubeGeometry args={[t.curve, 20, 0.07 + 0.42 * Math.sqrt(Math.max(t.conductivity, 0)), 8, false]} />
          <meshStandardMaterial color="#1f8096" emissive="#3ea3b8" emissiveIntensity={0.12 + Math.sqrt(t.flow) * 0.9} roughness={0.3} metalness={0.1} />
        </mesh>
      ))}
      {blocked.map((b) => (
        <mesh key={b.id} position={b.pos}>
          <octahedronGeometry args={[0.55]} />
          <meshStandardMaterial color="#c8321f" emissive="#e2492f" emissiveIntensity={0.45} roughness={0.5} />
        </mesh>
      ))}
      <Particles tubes={tubes} />
    </group>
  );
}

function Source3D({ position }: { position: [number, number, number] }) {
  const ring = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    const t = (clock.elapsedTime % 2.4) / 2.4;
    if (ring.current) ring.current.scale.setScalar(1 + t * 3);
    if (mat.current) mat.current.opacity = 0.8 * (1 - t);
  });
  return (
    <group position={position}>
      <mesh castShadow>
        <cylinderGeometry args={[1.5, 1.8, 0.7, 40]} />
        {/* terracotta well head (Tunisian pottery) */}
        <meshStandardMaterial color="#b9653a" roughness={0.88} metalness={0} />
      </mesh>
      <mesh position={[0, 0.37, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.35, 40]} />
        <meshStandardMaterial color="#2a95ab" emissive="#3ea3b8" emissiveIntensity={0.35} roughness={0.15} metalness={0.1} />
      </mesh>
      <mesh ref={ring} position={[0, 0.1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.5, 1.75, 48]} />
        <meshBasicMaterial ref={mat} color="#1f8096" transparent depthWrite={false} />
      </mesh>
      <mesh position={[0, 6, 0]}>
        <cylinderGeometry args={[0.25, 1.1, 12, 24, 1, true]} />
        <meshBasicMaterial color="#56aabc" transparent opacity={0.1} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ scene */

export default function Zone3D({
  fields,
  network,
  showSources = true,
  center,
  colors,
  selectedId,
  onSelect,
  hint,
}: {
  fields?: FieldCollection;
  network?: NetworkResponse;
  showSources?: boolean;
  center: [number, number];
  colors: string[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  hint: string;
}) {
  const project = useMemo(() => makeProjector(center), [center]);
  const [hovered, setHovered] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  // never leave a pointer cursor behind if the scene unmounts mid-hover
  useEffect(() => () => { document.body.style.cursor = ''; }, []);
  const hoveredFeature = fields?.features.find((f) => f.properties.field_id === hovered);
  const hoverPos = useMemo(() => {
    if (!hoveredFeature) return null;
    const [lon, lat] = ringCentroid(outerRings(hoveredFeature.geometry)[0] ?? [[0, 0]]);
    const [x, z] = project(lon, lat);
    return new THREE.Vector3(x, 6.5, z);
  }, [hoveredFeature, project]);

  return (
    <div className={`relative h-full w-full transition-opacity duration-700 ${ready ? 'opacity-100' : 'opacity-0'}`}>
      <Canvas shadows dpr={[1, 2]} camera={{ position: [0, 46, 60], fov: 42, near: 0.5, far: 700 }} onCreated={() => setReady(true)} onPointerMissed={() => setHovered(null)}>
        <color attach="background" args={['#f1ece2']} />
        <fog attach="fog" args={['#f1ece2', 110, 260]} />
        {/* warm Tunisian sun + sky/earth bounce */}
        <ambientLight intensity={0.5} />
        <hemisphereLight args={['#fff7e8', '#c9bfa8', 0.75]} />
        <directionalLight position={[-40, 30, -35]} intensity={0.35} color="#cfe6ea" />
        <directionalLight
          position={[45, 70, 30]}
          color="#fff1dc"
          intensity={1.7}
          shadow-bias={-0.0004}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-camera-left={-70}
          shadow-camera-right={70}
          shadow-camera-top={70}
          shadow-camera-bottom={-70}
        />
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[260, 260]} />
          <meshStandardMaterial color="#e9e2d3" roughness={1} />
        </mesh>
        <Grid
          position={[0, 0.02, 0]}
          args={[260, 260]}
          cellSize={1}
          cellThickness={0.5}
          cellColor="#ddd4c2"
          sectionSize={10}
          sectionThickness={0.9}
          sectionColor="#c9b28f"
          fadeDistance={170}
          fadeStrength={1.6}
          infiniteGrid
        />
        {fields?.features.map((f) => {
          const p = f.properties;
          const classified = p.is_irrigated && p.stress_class !== null;
          return (
            <Field3D
              key={p.field_id}
              feature={f}
              project={project}
              color={classified ? colors[p.stress_class as number] : NA_COLOR}
              height={classified ? 0.5 + (p.stress_score ?? 0) * 6 : 0.18}
              selected={p.field_id === selectedId}
              onSelect={onSelect}
              onHover={setHovered}
            />
          );
        })}
        {network && <Network3D network={network} project={project} />}
        {showSources &&
          network?.sources.map((s) => {
            const [x, z] = project(s.lon, s.lat);
            return <Source3D key={s.node_id} position={[x, 0.35, z]} />;
          })}
        {hoverPos && hoveredFeature && (
          <Html position={hoverPos} center distanceFactor={60} style={{ pointerEvents: 'none' }}>
            <div className="whitespace-nowrap rounded-lg border border-white/15 bg-ink-950/90 px-2 py-1 text-xs text-white shadow-panel">
              <b>{hoveredFeature.properties.field_id}</b> · {hoveredFeature.properties.area_ha} ha
            </div>
          </Html>
        )}
        <Sparkles count={70} scale={[100, 14, 100]} size={2.2} speed={0.25} color="#d99a1e" opacity={0.55} position={[0, 7, 0]} />
        <OrbitControls makeDefault enableDamping maxPolarAngle={Math.PI / 2.15} minDistance={16} maxDistance={180} autoRotate autoRotateSpeed={0.35} />
      </Canvas>
      <div className="chip pointer-events-none absolute bottom-3 start-3 bg-ink-950/80">{hint}</div>
    </div>
  );
}
