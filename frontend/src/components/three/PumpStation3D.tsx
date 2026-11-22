import { Html, OrbitControls, RoundedBox } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

export interface StationValve {
  edge_id: string;
  open: boolean;
  opening_pct: number;
}

interface Props {
  pumpOn: boolean;
  powerFrac: number; // 0..1 of rated pump power
  tankFrac: number; // 0..1
  solarFrac: number; // 0..1 of the day's peak
  hour: number;
  irrigating: boolean;
  valves: StationValve[];
  labels: { pump: string; tank: string; open: string; closed: string };
}

function Impeller({ speed }: { speed: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.z += dt * speed * 14;
  });
  return (
    <group ref={ref} position={[0, 0, 0.62]}>
      {Array.from({ length: 6 }).map((_, i) => (
        <mesh key={i} rotation={[0, 0, (i * Math.PI) / 3]} position={[0, 0, 0]}>
          <boxGeometry args={[0.14, 0.9, 0.08]} />
          <meshStandardMaterial color="#d9d4c8" metalness={0.7} roughness={0.3} />
        </mesh>
      ))}
      <mesh>
        <cylinderGeometry args={[0.16, 0.16, 0.12, 20]} />
        <meshStandardMaterial color="#d99a1e" emissive="#d99a1e" emissiveIntensity={speed > 0 ? 0.5 : 0.05} />
      </mesh>
    </group>
  );
}

function WaterFlow({ from, to, active, speed = 1, color = '#38a7bd' }: { from: THREE.Vector3; to: THREE.Vector3; active: boolean; speed?: number; color?: string }) {
  const N = 10;
  const ref = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const phase = useRef(0);
  useFrame((_, dt) => {
    const m = ref.current;
    if (!m) return;
    phase.current = (phase.current + dt * 0.6 * speed) % 1;
    for (let i = 0; i < N; i++) {
      const t = (i / N + phase.current) % 1;
      dummy.position.lerpVectors(from, to, t);
      dummy.scale.setScalar(active ? 1 : 0.0001);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, N]}>
      <sphereGeometry args={[0.09, 8, 8]} />
      <meshBasicMaterial color={color} toneMapped={false} />
    </instancedMesh>
  );
}

function Pipe({ from, to, radius = 0.12, color = '#9a9387' }: { from: THREE.Vector3; to: THREE.Vector3; radius?: number; color?: string }) {
  const { pos, quat, len } = useMemo(() => {
    const dir = new THREE.Vector3().subVectors(to, from);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    return { pos: new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5), quat: q, len: dir.length() };
  }, [from, to]);
  return (
    <mesh position={pos} quaternion={quat} castShadow>
      <cylinderGeometry args={[radius, radius, len, 14]} />
      <meshStandardMaterial color={color} metalness={0.45} roughness={0.45} />
    </mesh>
  );
}

function ValveWheel({ position, valve, labels, labelLift = 0 }: { position: THREE.Vector3; valve: StationValve; labels: Props['labels']; labelLift?: number }) {
  const ref = useRef<THREE.Group>(null);
  const target = (valve.opening_pct / 100) * Math.PI * 1.5;
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += (target - ref.current.rotation.y) * Math.min(1, dt * 3);
  });
  const color = valve.open ? '#2e9e4f' : '#c8321f';
  const textColor = valve.open ? '#1f6e3a' : '#a3221a'; // AA on the paper label
  return (
    <group position={position}>
      <mesh>
        <boxGeometry args={[0.36, 0.36, 0.36]} />
        <meshStandardMaterial color="#5f6761" metalness={0.6} roughness={0.4} />
      </mesh>
      <group ref={ref} position={[0, 0.45, 0]}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.32, 0.05, 10, 28]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3} />
        </mesh>
        {[0, Math.PI / 2].map((r) => (
          <mesh key={r} rotation={[0, r, 0]}>
            <boxGeometry args={[0.62, 0.04, 0.04]} />
            <meshStandardMaterial color={color} />
          </mesh>
        ))}
      </group>
      <Html position={[0, 1 + labelLift, 0]} center distanceFactor={14} style={{ pointerEvents: 'none' }}>
        <div className="whitespace-nowrap rounded-md border border-white/15 bg-ink-950/85 px-1.5 py-0.5 text-[10px] font-semibold text-white">
          {valve.edge_id} · <span style={{ color: textColor }}>{valve.open ? `${valve.opening_pct}%` : labels.closed}</span>
        </div>
      </Html>
    </group>
  );
}

function Scene({ pumpOn, powerFrac, tankFrac, solarFrac, hour, irrigating, valves, labels }: Props) {
  const water = useRef<THREE.Mesh>(null);
  const sun = useRef<THREE.Group>(null);
  const light = useRef<THREE.DirectionalLight>(null);
  const tankH = 4;
  const sunTarget = useMemo(() => new THREE.Vector3(), []); // reused every frame (no per-frame allocation)
  useFrame((_, dt) => {
    const k = Math.min(1, dt * 2.5);
    if (water.current) {
      const s = Math.max(0.02, tankFrac);
      water.current.scale.y += (s - water.current.scale.y) * k;
      water.current.position.y = (water.current.scale.y * tankH) / 2 + 0.05;
    }
    const angle = Math.PI * Math.max(0, Math.min(1, (hour + 0.5 - 6) / 13));
    const target = sunTarget.set(-Math.cos(angle) * 14, Math.max(-2, Math.sin(angle) * 11), -6);
    if (sun.current) sun.current.position.lerp(target, k);
    if (light.current) {
      light.current.position.copy(sun.current?.position ?? target);
      light.current.intensity += (0.45 + solarFrac * 1.4 - light.current.intensity) * k;
    }
  });

  const pumpOut = new THREE.Vector3(-1.2, 0.8, 0);
  const tankIn = new THREE.Vector3(1.6, 3.6, 0);
  const manifoldStart = new THREE.Vector3(3.6, 0.6, -3);
  const manifoldEnd = new THREE.Vector3(3.6, 0.6, 3);
  const shown = valves.slice(0, 7);

  return (
    <>
      <color attach="background" args={['#f1ece2']} />
      <fog attach="fog" args={['#f1ece2', 26, 62]} />
      <ambientLight intensity={0.5} />
      <hemisphereLight args={['#fff7e8', '#c9bfa8', 0.6]} />
      <directionalLight ref={light} castShadow color="#fff1dc" intensity={1} shadow-bias={-0.0005} shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
      <group ref={sun}>
        <mesh>
          <sphereGeometry args={[0.8, 24, 24]} />
          <meshBasicMaterial color="#f2b33d" toneMapped={false} />
        </mesh>
        <pointLight color="#ffd99a" intensity={solarFrac * 30} distance={40} />
      </group>

      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[16, 64]} />
        <meshStandardMaterial color="#e7dfcf" roughness={1} />
      </mesh>

      {/* PV array */}
      {Array.from({ length: 3 }).map((_, r) =>
        Array.from({ length: 4 }).map((__, c) => (
          <group key={`${r}-${c}`} position={[-8 + c * 1.5, 0.9, -3 + r * 2]} rotation={[-0.55, 0, 0]}>
            <RoundedBox args={[1.35, 0.06, 1.6]} radius={0.02} castShadow>
              <meshStandardMaterial color="#1d3b5c" emissive="#2f6f9a" emissiveIntensity={0.04 + solarFrac * 0.3} metalness={0.6} roughness={0.25} />
            </RoundedBox>
          </group>
        )),
      )}
      <Pipe from={new THREE.Vector3(-4.5, 0.15, 0)} to={new THREE.Vector3(-2.6, 0.15, 0)} radius={0.05} color={solarFrac > 0.05 ? '#d99a1e' : '#9a9387'} />

      {/* pump house */}
      <group position={[-2, 0, 0]}>
        <RoundedBox args={[2, 1.6, 2]} radius={0.12} position={[0, 0.8, 0]} castShadow>
          {/* whitewashed pump house with a Sidi Bou Said blue door */}
          <meshStandardMaterial color="#f5efe4" metalness={0} roughness={0.92} />
        </RoundedBox>
        <RoundedBox args={[0.7, 1.05, 0.06]} radius={0.04} position={[0.5, 0.6, -1.0]}>
          <meshStandardMaterial color="#1f5f8b" roughness={0.6} />
        </RoundedBox>
        <group position={[0, 0.9, 0.42]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.6, 0.6, 0.3, 32]} />
            <meshStandardMaterial color={pumpOn ? '#1f8096' : '#8a8f86'} emissive={pumpOn ? '#1f8096' : '#000000'} emissiveIntensity={pumpOn ? 0.3 : 0} />
          </mesh>
          <Impeller speed={pumpOn ? 0.3 + powerFrac : 0} />
        </group>
        <Html position={[0, 2.2, 0]} center distanceFactor={14} style={{ pointerEvents: 'none' }}>
          <div className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${pumpOn ? 'bg-water-500 text-ink-950' : 'bg-slate-700 text-slate-200'}`}>{labels.pump}</div>
        </Html>
      </group>

      {/* tank */}
      <group position={[1.6, 0, 0]}>
        <mesh position={[0, tankH / 2, 0]}>
          <cylinderGeometry args={[1.25, 1.25, tankH, 40, 1, true]} />
          <meshStandardMaterial color="#b8c4c2" transparent opacity={0.28} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
        <mesh ref={water} scale={[1, 0.3, 1]} position={[0, 0.6, 0]}>
          <cylinderGeometry args={[1.18, 1.18, tankH, 40]} />
          <meshStandardMaterial color="#2a95ab" emissive="#1f8096" emissiveIntensity={0.18} roughness={0.15} transparent opacity={0.85} />
        </mesh>
        <Html position={[0, tankH + 0.6, 0]} center distanceFactor={14} style={{ pointerEvents: 'none' }}>
          <div className="rounded-md bg-ink-950/85 px-2 py-0.5 text-[11px] font-bold text-water-200">
            {labels.tank} {Math.round(tankFrac * 100)}%
          </div>
        </Html>
      </group>

      <Pipe from={pumpOut} to={new THREE.Vector3(0.3, 0.8, 0)} />
      <Pipe from={new THREE.Vector3(0.3, 0.8, 0)} to={new THREE.Vector3(0.3, 3.6, 0)} />
      <Pipe from={new THREE.Vector3(0.3, 3.6, 0)} to={tankIn} />
      <WaterFlow from={new THREE.Vector3(0.3, 0.8, 0.15)} to={new THREE.Vector3(0.3, 3.6, 0.15)} active={pumpOn} speed={0.6 + powerFrac * 2} />

      {/* manifold + branches */}
      <Pipe from={new THREE.Vector3(2.85, 0.6, 0)} to={new THREE.Vector3(3.6, 0.6, 0)} />
      <Pipe from={manifoldStart} to={manifoldEnd} radius={0.16} />
      {shown.map((v, i) => {
        const z = shown.length > 1 ? -3 + (6 * i) / (shown.length - 1) : 0;
        const start = new THREE.Vector3(3.6, 0.6, z);
        const end = new THREE.Vector3(9, 0.6, z);
        return (
          <group key={v.edge_id}>
            <Pipe from={start} to={end} radius={0.09} color={v.open ? '#1f8096' : '#9a9387'} />
            {/* alternate label heights so neighbouring valve tags never overlap */}
            <ValveWheel position={new THREE.Vector3(5.4, 0.6, z)} valve={v} labels={labels} labelLift={i % 2 ? 0.75 : 0} />
            <WaterFlow from={new THREE.Vector3(5.7, 0.62, z)} to={end} active={v.open && irrigating} speed={0.4 + v.opening_pct / 60} />
          </group>
        );
      })}
      <OrbitControls makeDefault enableDamping maxPolarAngle={Math.PI / 2.1} minDistance={8} maxDistance={40} autoRotate autoRotateSpeed={0.25} />
    </>
  );
}

export default function PumpStation3D(props: Props) {
  const [ready, setReady] = useState(false);
  return (
    // fade in once WebGL is up, so the light frame never flashes an empty canvas
    <div className={`h-full w-full transition-opacity duration-700 ${ready ? 'opacity-100' : 'opacity-0'}`}>
      <Canvas shadows dpr={[1, 2]} camera={{ position: [6, 9, 16], fov: 42 }} onCreated={() => setReady(true)}>
        <Scene {...props} />
      </Canvas>
    </div>
  );
}
