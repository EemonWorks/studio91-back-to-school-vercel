import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { Component, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BENCH_COUNT, BENCH_DEPTH, BENCH_REAR_EXTENT, BENCH_WIDTH, ROWS, SEATS_PER_BENCH, benchPosition, groupFor, rowDepth } from './shared';
import { CatMarker, PencilMound, graffitiDrawing } from './DeskDetails';

interface Props {
  counts: number[];
  selected: number | null;
  heatmap: boolean;
  onSelect: (seat: number) => void;
  onHover: (seat: number | null) => void;
  reset: number;
  zoom: number;
  onUnavailable: () => void;
}

class SceneBoundary extends Component<{ children: ReactNode; onUnavailable: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) {
    console.error('The 3D classroom could not load:', error);
    this.props.onUnavailable();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function Box({ position, size, color, ...props }: {
  position: [number, number, number];
  size: [number, number, number];
  color: string;
  rotation?: [number, number, number];
  castShadow?: boolean;
}) {
  return <mesh position={position} receiveShadow {...props}>
    <boxGeometry args={size} />
    <meshStandardMaterial color={color} roughness={0.85} />
  </mesh>;
}

function PaintedPanel({ position, size, draw, rotation = [0, 0, 0] }: {
  position: [number, number, number];
  size: [number, number];
  draw: (ctx: CanvasRenderingContext2D) => void;
  rotation?: [number, number, number];
}) {
  const { invalidate } = useThree();
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas drawing is unavailable.');
    draw(ctx);
    const result = new THREE.CanvasTexture(canvas);
    result.colorSpace = THREE.SRGBColorSpace;
    return result;
  }, [draw]);
  useEffect(() => {
    let active = true;
    void document.fonts.ready.then(() => {
      if (!active || !(texture.image instanceof HTMLCanvasElement)) return;
      const ctx = texture.image.getContext('2d');
      if (ctx) {
        draw(ctx);
        texture.needsUpdate = true;
        invalidate();
      }
    });
    return () => { active = false; };
  }, [draw, texture, invalidate]);
  useEffect(() => () => texture.dispose(), [texture]);
  return <mesh position={position} rotation={rotation}>
    <planeGeometry args={size} />
    <meshBasicMaterial map={texture} transparent />
  </mesh>;
}

function BoardArtwork() {
  const texture = useLoader(THREE.TextureLoader, `${import.meta.env.BASE_URL}visuals/board.webp`);
  texture.colorSpace = THREE.SRGBColorSpace;
  return <mesh position={[0.4, 3.15, -5.965]}>
    <planeGeometry args={[7.35, 7.35 * 768 / 1365]} />
    <meshBasicMaterial map={texture} />
  </mesh>;
}

const poster = (ctx: CanvasRenderingContext2D) => {
  ctx.fillStyle = '#fff0be'; ctx.fillRect(0, 0, 1024, 512);
  ctx.fillStyle = '#8d4a57'; ctx.textAlign = 'center';
  ctx.font = '80px "Patrick Hand", cursive'; ctx.fillText('Stay curious.', 512, 125);
  ctx.font = '32px "Patrick Hand", cursive'; ctx.fillText('On the timetable: good times', 512, 190);
  ctx.strokeStyle = '#9b488c'; ctx.lineWidth = 3;
  for (let i = 0; i < 7; i++) {
    const x = 70 + i * 147;
    ctx.beginPath(); ctx.moveTo(x, 235); ctx.lineTo(x, 465); ctx.stroke();
  }
  for (const y of [235, 350, 465]) {
    ctx.beginPath(); ctx.moveTo(70, y); ctx.lineTo(952, y); ctx.stroke();
  }
  ctx.font = '60px "Patrick Hand", cursive';
  Array.from({ length: 12 }, (_, i) => {
    ctx.fillText(String(i + 1), 143 + (i % 6) * 147, i < 6 ? 312 : 427);
  });
};

const clockFace = (ctx: CanvasRenderingContext2D) => {
  ctx.clearRect(0, 0, 1024, 512);
  ctx.save(); ctx.translate(512, 256); ctx.scale(1, 2);
  ctx.fillStyle = '#fff8ff'; ctx.beginPath(); ctx.arc(0, 0, 120, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#f15298'; ctx.lineWidth = 11; ctx.stroke();
  ctx.fillStyle = '#293260';
  for (let i = 0; i < 12; i++) {
    const angle = i * Math.PI / 6;
    ctx.beginPath(); ctx.arc(Math.sin(angle) * 100, -Math.cos(angle) * 100, 3.5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.lineWidth = 7; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-44, -30); ctx.lineTo(0, 0); ctx.lineTo(0, -76); ctx.stroke();
  ctx.restore();
};

function Plant({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return <group position={position} scale={scale}>
    <mesh position={[0, 0.25, 0]} castShadow>
      <cylinderGeometry args={[0.24, 0.17, 0.5, 12]} />
      <meshStandardMaterial color="#dc64b0" />
    </mesh>
    <mesh position={[0, 0.52, 0]}>
      <cylinderGeometry args={[0.2, 0.2, 0.04, 12]} />
      <meshStandardMaterial color="#504637" />
    </mesh>
    {[0, 1, 2, 3, 4, 5].map((i) => <mesh
      key={i}
      position={[Math.sin(i * 2.4) * 0.17, 0.78 + (i % 3) * 0.12, Math.cos(i * 2.4) * 0.17]}
      rotation={[Math.sin(i) * 0.5, i, Math.cos(i) * 0.6]}
      scale={[0.12, 0.4, 0.17]}
      castShadow
    ><sphereGeometry args={[1, 8, 8]} /><meshStandardMaterial color={i % 2 ? '#9ebd31' : '#37834c'} /></mesh>)}
  </group>;
}

function Bookcase({ position }: { position: [number, number, number] }) {
  const bookColors = ['#afd93e', '#ffd13b', '#f767a7', '#8bd0f5', '#9b77d6', '#ef7355'];
  return <group position={position}>
    <Box position={[0, 0.95, 0]} size={[2.1, 1.9, 0.55]} color="#8071ca" />
    {[0.37, 1.02, 1.65].map((y, row) => <group key={y}>
      <Box position={[0, y, 0.29]} size={[1.85, 0.52, 0.04]} color="#51418d" />
      {Array.from({ length: 8 }, (_, i) => <Box key={i}
        position={[-0.78 + i * 0.21, y + 0.01, 0.33]}
        size={[0.14, 0.32 + ((i + row) % 3) * 0.06, 0.25]}
        color={bookColors[(i + row) % bookColors.length] ?? '#e5c992'}
        rotation={[0, 0, i === 6 ? -0.15 : 0]} />)}
      <Box position={[0, y - 0.29, 0.1]} size={[2.1, 0.09, 0.65]} color="#b4a1ed" />
    </group>)}
  </group>;
}

function Window({ z }: { z: number }) {
  return <group position={[-7.87, 3.3, z]} rotation={[0, Math.PI / 2, 0]}>
    <Box position={[0, 0, 0]} size={[3.5, 2.65, 0.09]} color="#c3d6c6" />
    <Box position={[0, 0, 0.06]} size={[3.18, 2.34, 0.04]} color="#d2eaff" />
    <mesh position={[-0.8, -0.35, 0.1]}>
      <circleGeometry args={[0.73, 24]} /><meshBasicMaterial color="#b4c9a7" />
    </mesh>
    <mesh position={[0.92, -0.65, 0.11]}>
      <circleGeometry args={[1, 24]} /><meshBasicMaterial color="#b9cda9" />
    </mesh>
    <Box position={[0, 0, 0.13]} size={[0.09, 2.65, 0.12]} color="#6e71c0" />
    <Box position={[0, 0.2, 0.13]} size={[3.5, 0.09, 0.12]} color="#6e71c0" />
    <Box position={[0, -1.37, 0.12]} size={[3.8, 0.13, 0.4]} color="#dfcba7" />
    <Box position={[-1.85, 0, 0.03]} size={[0.22, 2.95, 0.2]} color="#c6a37b" />
    <Box position={[1.85, 0, 0.03]} size={[0.22, 2.95, 0.2]} color="#c6a37b" />
    <Box position={[0, 1.42, 0.03]} size={[3.9, 0.2, 0.2]} color="#c6a37b" />
  </group>;
}

function SolarSystem() {
  return <group position={[4.5, 4.65, -2.7]} rotation={[0, -0.15, 0]}>
    <Box position={[0, 0.65, 0]} size={[3.8, 0.055, 0.055]} color="#a28d6b" />
    {[
      { x: -1.5, y: 0.1, r: 0.31, c: '#ffcb21' },
      { x: -0.6, y: -0.2, r: 0.13, c: '#ed69ac' },
      { x: 0.05, y: 0.1, r: 0.22, c: '#189ce0' },
      { x: 0.8, y: -0.45, r: 0.17, c: '#c4df45' },
      { x: 1.6, y: -0.05, r: 0.29, c: '#a384d7' },
    ].map((p, i) => <group key={i} position={[p.x, p.y, 0]}>
      <mesh position={[0, (0.65 - p.y) / 2, 0]}>
        <cylinderGeometry args={[0.008, 0.008, 0.65 - p.y, 5]} /><meshStandardMaterial color="#b9ac8e" />
      </mesh>
      <mesh castShadow><sphereGeometry args={[p.r, 20, 16]} /><meshStandardMaterial color={p.c} roughness={0.8} /></mesh>
      {i === 4 && <mesh rotation={[1.15, 0.2, 0]}>
        <torusGeometry args={[0.42, 0.055, 8, 32]} /><meshStandardMaterial color="#e2c99e" />
      </mesh>}
    </group>)}
  </group>;
}

function SeatZone({ seat, count, selected, heatmap, maximum, onSelect, onHover }: {
  seat: number; count: number; selected: boolean; heatmap: boolean; maximum: number;
  onSelect: Props['onSelect']; onHover: Props['onHover'];
}) {
  const [hovered, setHovered] = useState(false);
  const color = selected ? '#bce64b' : heatmap && count
    ? new THREE.Color('#fff3a0').lerp(new THREE.Color('#e7337f'), count / maximum).getStyle()
    : '#ffffff';
  const enter = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    setHovered(true);
    onHover(seat);
    document.body.style.cursor = 'pointer';
  };
  return <group position={[(seat % SEATS_PER_BENCH === 0 ? -1 : 1) * BENCH_WIDTH / 4, 0, 0]}>
    {(selected || hovered || (heatmap && count > 0)) && <mesh position={[0, 1.155, 0]} receiveShadow>
      <boxGeometry args={[1.13, 0.018, 0.84]} />
      <meshStandardMaterial color={color} transparent opacity={selected || heatmap ? 0.92 : 0.4} />
    </mesh>}
    {count === 0 && !selected && <>
      <Box position={[-0.13, 1.185, -0.06]} size={[0.38, 0.035, 0.44]} color="#fff9ee" rotation={[0, -0.13, 0]} />
      <Box position={[-0.31, 1.207, -0.04]} size={[0.035, 0.008, 0.4]} color="#575bc3" rotation={[0, -0.13, 0]} />
    </>}
    {(count > 0 || selected) && <CatMarker yours={selected} side={seat % 2 === 0 ? -1 : 1} />}
    {selected && <Box position={[0, 0.628, 0.82]} size={[1.07, 0.018, 0.4]} color="#bce64b" />}
    <mesh position={[0, 0.95, 0.28]}
      onClick={(event) => { event.stopPropagation(); onSelect(seat); }}
      onPointerOver={enter} onPointerOut={() => { setHovered(false); onHover(null); document.body.style.cursor = ''; }}>
      <boxGeometry args={[1.19, 0.9, 1.7]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  </group>;
}

function BenchDesk({ bench, counts, selected, heatmap, maximum, topGeometry, onSelect, onHover }: {
  bench: number; counts: number[]; selected: number | null; heatmap: boolean; maximum: number;
  topGeometry: THREE.BufferGeometry; onSelect: Props['onSelect']; onHover: Props['onHover'];
}) {
  const firstSeat = bench * SEATS_PER_BENCH;
  const group = groupFor(firstSeat);
  const scribbles = useMemo(() => graffitiDrawing(bench), [bench]);
  const pencilCount = (counts[firstSeat] ?? 0) + (counts[firstSeat + 1] ?? 0);
  const topColor = ['#ffd99c', '#8dd8e5', '#efa7cc'][group] ?? '#ffd99c';
  const benchColor = ['#78b6ac', '#7ba5bf', '#ba8ca8'][group] ?? '#78b6ac';
  return <group position={benchPosition(bench)} name={`two-person-bench-${bench}`}>
    <mesh position={[0, 1.08, 0]} geometry={topGeometry} castShadow receiveShadow>
      <meshStandardMaterial color={topColor} roughness={group === 2 ? 0.98 : 0.6} />
    </mesh>
    {group === 2 && <PaintedPanel position={[0, 1.17, 0]} size={[BENCH_WIDTH - 0.1, BENCH_DEPTH - 0.06]}
      rotation={[-Math.PI / 2, 0, 0]} draw={scribbles} />}
    {pencilCount > 0 && <PencilMound count={pencilCount} />}
    {[-1.02, 1.02].flatMap((x) => [-0.31, 0.31].map((z) =>
      <Box key={`${x}-${z}`} position={[x, 0.52, z]} size={[0.065, 1.02, 0.065]} color="#35416e" />))}
    <Box position={[0, 0.78, 0.18]} size={[2.17, 0.06, 0.46]} color="#7280bd" />
    <Box position={[0, 0.57, 0.82]} size={[2.27, 0.1, 0.46]} color={benchColor} castShadow />
    <Box position={[0, 1.02, 1.04]} size={[2.27, 0.35, 0.085]} color={benchColor} castShadow />
    {[-0.99, 0.99].flatMap((x) => [0.68, 0.99].map((z) =>
      <Box key={`${x}-${z}`} position={[x, 0.28, z]} size={[0.06, 0.54, 0.06]} color="#35416e" />))}
    {[-0.99, 0.99].map((x) => <Box key={x} position={[x, 0.83, 1.03]} size={[0.05, 0.5, 0.05]} color="#35416e" />)}
    {Array.from({ length: SEATS_PER_BENCH }, (_, side) => <SeatZone key={side}
      seat={firstSeat + side} count={counts[firstSeat + side] ?? 0}
      selected={selected === firstSeat + side} heatmap={heatmap} maximum={maximum}
      onSelect={onSelect} onHover={onHover} />)}
  </group>;
}

function CameraControls({ reset, zoom, onUnavailable }: { reset: number; zoom: number; onUnavailable: () => void }) {
  const { camera, gl, size, invalidate } = useThree();
  const controls = useRef<OrbitControls | null>(null);
  const previousZoom = useRef(zoom);
  useEffect(() => {
    const canvas = gl.domElement;
    canvas.addEventListener('webglcontextlost', onUnavailable, { once: true });
    return () => canvas.removeEventListener('webglcontextlost', onUnavailable);
  }, [gl, onUnavailable]);
  useEffect(() => {
    const orbit = new OrbitControls(camera, gl.domElement);
    orbit.enableDamping = true;
    orbit.enablePan = false;
    orbit.minPolarAngle = 0.35;
    orbit.maxPolarAngle = 1.25;
    orbit.minAzimuthAngle = -0.6;
    orbit.maxAzimuthAngle = 1.25;
    orbit.minZoom = 15;
    orbit.maxZoom = 75;
    orbit.target.set(0, 1.3, 0.6);
    orbit.addEventListener('change', () => invalidate());
    controls.current = orbit;
    return () => { orbit.dispose(); controls.current = null; };
  }, [camera, gl, invalidate]);
  useEffect(() => {
    camera.position.set(18, 16, 22);
    if (camera instanceof THREE.OrthographicCamera) {
      camera.zoom = Math.min(size.width / 24, size.height / 17.5);
      camera.updateProjectionMatrix();
    }
    controls.current?.target.set(0, 1.3, 0.6);
    controls.current?.update();
    invalidate();
  }, [camera, size.width, size.height, reset, invalidate]);
  useEffect(() => {
    if (camera instanceof THREE.OrthographicCamera) {
      camera.zoom = THREE.MathUtils.clamp(camera.zoom * Math.pow(1.2, zoom - previousZoom.current), 15, 75);
      camera.updateProjectionMatrix();
      previousZoom.current = zoom;
      invalidate();
    }
  }, [camera, zoom, invalidate]);
  useFrame(() => controls.current?.update());
  return null;
}

function Scene(props: Props) {
  const top = useMemo(() => new RoundedBoxGeometry(BENCH_WIDTH, 0.13, BENCH_DEPTH, 3, 0.055), []);
  useEffect(() => () => top.dispose(), [top]);
  const maximum = Math.max(1, ...props.counts);
  return <>
    <CameraControls reset={props.reset} zoom={props.zoom} onUnavailable={props.onUnavailable} />
    <ambientLight intensity={1.2} />
    <hemisphereLight args={['#fff6fb', '#9ba6cf', 1.3]} />
    <directionalLight position={[-8, 16, 4]} intensity={2.5} castShadow
      shadow-mapSize={[2048, 2048]} shadow-camera-left={-15} shadow-camera-right={15}
      shadow-camera-top={15} shadow-camera-bottom={-15} shadow-normalBias={0.04} shadow-bias={-0.0002} />
    <group position={[0, -0.5, 0]}>
      <Box position={[0, -0.3, 0.65]} size={[16.3, 0.5, 14.3]} color="#8fb5a7" castShadow />
      <Box position={[0, -0.01, 0.65]} size={[16, 0.08, 14]} color="#eadfd7" />
      {Array.from({ length: 19 }, (_, i) => <Box key={i}
        position={[-7.6 + i * 0.84, 0.038, 0.65]} size={[0.012, 0.004, 14]} color="#d4c8c0" />)}
      {Array.from({ length: 7 }, (_, i) => <Box key={i}
        position={[0, 0.04, -5.3 + i * 1.93]} size={[16, 0.004, 0.012]} color="#d4c8c0" />)}
      {Array.from({ length: ROWS - 1 }, (_, row) => <Box key={row}
        position={[0, 0.047, (rowDepth(row) + BENCH_REAR_EXTENT + rowDepth(row + 1) - BENCH_DEPTH / 2) / 2]}
        size={[14.2, 0.012, 0.46]} color="#c8c6e8" />)}
      <Box position={[0, 2.65, -6.3]} size={[16.2, 5.4, 0.2]} color="#f4e3cc" castShadow />
      <Box position={[-8, 2.65, 0.65]} size={[0.2, 5.4, 14.1]} color="#e5eee0" castShadow />
      <Box position={[0, 0.68, -6.16]} size={[16, 1.35, 0.1]} color="#87b9a6" />
      <Box position={[-7.87, 0.68, 0.65]} size={[0.09, 1.35, 14]} color="#9ac8bc" />
      <Box position={[0, 1.4, -6.06]} size={[16, 0.085, 0.16]} color="#7b67af" />
      <Box position={[-7.78, 1.4, 0.65]} size={[0.16, 0.085, 14]} color="#666db5" />
      <Box position={[0, 5.35, -6.25]} size={[16.3, 0.18, 0.3]} color="#d679af" />
      <Box position={[-7.96, 5.35, 0.7]} size={[0.3, 0.18, 14.3]} color="#8a94ce" />
      <Window z={-2.5} /><Window z={2.2} />
      <Plant position={[-7.5, 2, -2]} scale={0.65} />
      <Plant position={[-7.5, 2, 2.8]} scale={0.65} />
      <Box position={[0.4, 3.15, -6.06]} size={[7.5, 4.2, 0.15]} color="#cf9964" />
      <BoardArtwork />
      <Box position={[-5.1, 3.55, -6.04]} size={[2.4, 1.7, 0.12]} color="#9b60ac" />
      <PaintedPanel position={[-5.1, 3.55, -5.96]} size={[2.25, 1.52]} draw={poster} />
      <PaintedPanel position={[5.9, 3.9, -6.02]} size={[2.3, 1.15]} draw={clockFace} />
      <Bookcase position={[-5.7, 0, -5.5]} />
      <Plant position={[-6.3, 1.92, -5.5]} scale={0.85} />
      <group position={[-0.9, 0, -4.95]}>
        <Box position={[0, 1.18, 0]} size={[2.8, 0.16, 1.1]} color="#ffd43c" castShadow />
        <Box position={[0, 0.58, 0]} size={[2.55, 1.08, 0.82]} color="#6553b2" castShadow />
        <Box position={[0, 0.64, 0.44]} size={[2.23, 0.84, 0.045]} color="#9380d3" />
        <Box position={[-0.75, 1.32, 0]} size={[0.54, 0.1, 0.4]} color="#ded0ab" />
        <Box position={[-0.75, 1.42, 0]} size={[0.5, 0.08, 0.38]} color="#b78666" />
        <Plant position={[0.86, 1.27, 0]} scale={0.6} />
      </group>
      <Plant position={[6.9, 0, -4.9]} scale={1.7} />
      <SolarSystem />
      {Array.from({ length: BENCH_COUNT }, (_, bench) => <BenchDesk key={bench} bench={bench}
        counts={props.counts} selected={props.selected}
        heatmap={props.heatmap} maximum={maximum} topGeometry={top}
        onSelect={props.onSelect} onHover={props.onHover} />)}
    </group>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.07, 0]} receiveShadow>
      <planeGeometry args={[200, 200]} /><shadowMaterial opacity={0.13} />
    </mesh>
  </>;
}

export default function Classroom(props: Props) {
  return <SceneBoundary onUnavailable={props.onUnavailable}>
    <Canvas style={{ position: 'absolute', inset: 0 }} orthographic camera={{ position: [18, 16, 22], zoom: 30, near: 0.1, far: 150 }}
      shadows frameloop="demand" dpr={[1, 1.6]}
      gl={{ antialias: true, alpha: true }}
      onCreated={({ gl }) => {
        gl.domElement.setAttribute('aria-label', 'Interactive 3D classroom. Drag to rotate; click your side of a two-person bench to choose it. Use Seat map for keyboard access.');
        gl.domElement.setAttribute('role', 'img');
      }}>
      <Suspense fallback={null}><Scene {...props} /></Suspense>
    </Canvas>
  </SceneBoundary>;
}
