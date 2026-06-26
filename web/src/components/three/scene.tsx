"use client";

import { useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import * as THREE from "three";
import { scrollState, damp } from "@/lib/scroll-store";

/* ── Cryo palette ────────────────────────────────────────── */
const NAVY = new THREE.Color("#060c14");
const BLUE = new THREE.Color("#3e8fe6"); // glacier
const CYAN = new THREE.Color("#6fe9ff"); // signature cold cyan
const PURPLE = new THREE.Color("#164f86"); // deep blue (was purple)
const GLOW = new THREE.Color("#5fe0ff");
const LAV = new THREE.Color("#a3f0ff"); // ice (was lavender)

const R = 3; // globe radius

/* ── helpers ─────────────────────────────────────────────── */
function fibonacciSphere(n: number, radius: number) {
  const pts: THREE.Vector3[] = [];
  const phi = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const t = phi * i;
    pts.push(new THREE.Vector3(Math.cos(t) * r * radius, y * radius, Math.sin(t) * r * radius));
  }
  return pts;
}

/** Slerped great-circle arc lifted off the surface. */
function arcPoints(a: THREE.Vector3, b: THREE.Vector3, lift: number, seg = 60) {
  const va = a.clone().normalize();
  const vb = b.clone().normalize();
  const out: THREE.Vector3[] = [];
  const dot = THREE.MathUtils.clamp(va.dot(vb), -1, 1);
  const omega = Math.acos(dot) || 1e-4;
  const sinO = Math.sin(omega);
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const s1 = Math.sin((1 - t) * omega) / sinO;
    const s2 = Math.sin(t * omega) / sinO;
    const p = va.clone().multiplyScalar(s1).add(vb.clone().multiplyScalar(s2));
    const h = 1 + lift * Math.sin(Math.PI * t);
    out.push(p.multiplyScalar(R * h));
  }
  return out;
}

/** Round soft sprite for the globe dots. */
function dotTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.4, "rgba(180,230,255,0.9)");
  grad.addColorStop(1, "rgba(180,230,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

/* ── globe ───────────────────────────────────────────────── */
function Globe() {
  const group = useRef<THREE.Group>(null);
  const sprite = useMemo(() => dotTexture(), []);

  const { positions, colors } = useMemo(() => {
    const pts = fibonacciSphere(2600, R);
    const pos = new Float32Array(pts.length * 3);
    const col = new Float32Array(pts.length * 3);
    pts.forEach((p, i) => {
      pos[i * 3] = p.x;
      pos[i * 3 + 1] = p.y;
      pos[i * 3 + 2] = p.z;
      // dim the dots so they sit BELOW the bloom threshold → no twinkle/flicker
      const c = CYAN.clone().lerp(BLUE, Math.random() * 0.7).multiplyScalar(0.55);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    });
    return { positions: pos, colors: col };
  }, []);

  // fresnel atmosphere shader
  const atmo = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: { c: { value: GLOW } },
        vertexShader: `
          varying vec3 vN; varying vec3 vV;
          void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0);
            vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `
          varying vec3 vN; varying vec3 vV; uniform vec3 c;
          void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 4.2);
            gl_FragColor = vec4(c, f * 0.38); }`,
      }),
    [],
  );

  useFrame((_, dt) => {
    if (group.current) group.current.rotation.y += dt * 0.06;
  });

  return (
    <group ref={group}>
      {/* occluding core so back-facing dots are hidden → reads as a solid globe.
          polygonOffset pushes it slightly back so surface dots never z-fight. */}
      <mesh>
        <sphereGeometry args={[R * 0.97, 64, 64]} />
        <meshStandardMaterial
          color={"#070a2e"}
          roughness={1}
          metalness={0}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      </mesh>
      {/* dot field */}
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[colors, 3]} />
        </bufferGeometry>
        <pointsMaterial
          size={0.075}
          map={sprite}
          vertexColors
          transparent
          depthWrite={false}
          sizeAttenuation
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </points>
      {/* atmosphere — soft thin halo */}
      <mesh material={atmo}>
        <sphereGeometry args={[R * 1.1, 48, 48]} />
      </mesh>
      <Arcs />
    </group>
  );
}

/* ── data arcs with travelling pulses ────────────────────── */
function Arcs() {
  const arcs = useMemo(() => {
    const surf = fibonacciSphere(40, R);
    const list: { pts: THREE.Vector3[]; color: THREE.Color; speed: number; offset: number }[] = [];
    for (let i = 0; i < 12; i++) {
      const a = surf[(i * 7) % surf.length]!;
      const b = surf[(i * 13 + 5) % surf.length]!;
      const pts = arcPoints(a, b, 0.35 + Math.random() * 0.25);
      const color = [CYAN, GLOW, PURPLE, LAV][i % 4]!.clone();
      list.push({ pts, color, speed: 0.18 + Math.random() * 0.22, offset: Math.random() });
    }
    return list;
  }, []);

  return (
    <group>
      {arcs.map((arc, i) => (
        <Arc key={i} {...arc} />
      ))}
    </group>
  );
}

function Arc({
  pts,
  color,
  speed,
  offset,
}: {
  pts: THREE.Vector3[];
  color: THREE.Color;
  speed: number;
  offset: number;
}) {
  const pulse = useRef<THREE.Mesh>(null);
  const lineGeom = useMemo(() => new THREE.BufferGeometry().setFromPoints(pts), [pts]);
  const curve = useMemo(() => new THREE.CatmullRomCurve3(pts), [pts]);

  useFrame((state) => {
    const t = (state.clock.elapsedTime * speed + offset) % 1;
    if (pulse.current) {
      const p = curve.getPoint(t);
      pulse.current.position.copy(p);
      const s = 0.05 + 0.05 * Math.sin(t * Math.PI);
      pulse.current.scale.setScalar(s);
    }
  });

  return (
    <group>
      <primitive object={new THREE.Line(lineGeom, new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.28,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }))} />
      <mesh ref={pulse}>
        <sphereGeometry args={[1, 12, 12]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
    </group>
  );
}

/* ── server cluster — stacked rack blades (reveals on scroll) ── */
const RACKS = [
  { x: -1.15, z: 0.3, rot: 0.18 },
  { x: 1.15, z: -0.35, rot: -0.16 },
];
const BLADES = 6;

function ServerCluster() {
  const group = useRef<THREE.Group>(null);
  const leds = useRef<THREE.Mesh[]>([]);
  leds.current = [];

  // energy beams linking the two racks
  const beams = useMemo(() => {
    const segs: [THREE.Vector3, THREE.Vector3][] = [];
    for (let i = 0; i < 3; i++) {
      const a = new THREE.Vector3(RACKS[0]!.x + 0.8, -0.9 + i * 0.9, RACKS[0]!.z);
      const b = new THREE.Vector3(RACKS[1]!.x - 0.8, 0.9 - i * 0.9, RACKS[1]!.z);
      segs.push([a, b]);
    }
    return segs;
  }, []);

  useFrame((state, dt) => {
    const g = group.current;
    if (!g) return;
    const p = scrollState.progress;
    const reveal = THREE.MathUtils.clamp((p - 0.28) / 0.34, 0, 1);
    g.scale.setScalar(damp(g.scale.x, 0.0001 + reveal * 1.0, 5, dt));
    g.visible = reveal > 0.02;
    g.rotation.y = damp(g.rotation.y, -0.35 + state.pointer.x * 0.18, 3, dt) + dt * 0.04 * reveal;
    // a processing pulse travels UP each rack
    const t = state.clock.elapsedTime;
    leds.current.forEach((led) => {
      if (!led) return;
      const { rack, row } = led.userData as { rack: number; row: number };
      const wave = (Math.sin(t * 2.2 - row * 0.7 - rack * 1.5) + 1) / 2;
      const m = led.material as THREE.MeshBasicMaterial;
      m.opacity = (0.25 + 0.75 * wave) * reveal;
      led.scale.setScalar(0.8 + wave * 0.6);
    });
  });

  return (
    <group position={[4.3, 0.2, 0]}>
      <group ref={group}>
        {RACKS.map((rack, ri) => (
          <group key={ri} position={[rack.x, 0, rack.z]} rotation={[0, rack.rot, 0]}>
            {/* rack frame */}
            <mesh>
              <boxGeometry args={[1.7, 3.0, 1.0]} />
              <meshBasicMaterial color={BLUE} wireframe transparent opacity={0.22} toneMapped={false} />
            </mesh>
            {Array.from({ length: BLADES }).map((_, i) => {
              const y = -1.2 + i * (2.4 / (BLADES - 1));
              return (
                <group key={i} position={[0, y, 0]}>
                  {/* blade body */}
                  <mesh>
                    <boxGeometry args={[1.55, 0.26, 0.92]} />
                    <meshStandardMaterial
                      color={"#0a0e3a"}
                      emissive={CYAN}
                      emissiveIntensity={0.12}
                      roughness={0.4}
                      metalness={0.7}
                    />
                  </mesh>
                  {/* front LED status bar */}
                  <mesh
                    position={[0, 0, 0.49]}
                    ref={(m) => {
                      if (m) {
                        m.userData = { rack: ri, row: i };
                        leds.current.push(m);
                      }
                    }}
                  >
                    <boxGeometry args={[1.2, 0.06, 0.04]} />
                    <meshBasicMaterial
                      color={ri === 0 ? CYAN : GLOW}
                      transparent
                      opacity={0.6}
                      blending={THREE.AdditiveBlending}
                      toneMapped={false}
                    />
                  </mesh>
                </group>
              );
            })}
          </group>
        ))}
        {/* energy beams between racks */}
        {beams.map(([a, b], i) => (
          <primitive
            key={`b${i}`}
            object={new THREE.Line(
              new THREE.BufferGeometry().setFromPoints([a, b]),
              new THREE.LineBasicMaterial({
                color: i === 1 ? PURPLE : CYAN,
                transparent: true,
                opacity: 0.3,
                blending: THREE.AdditiveBlending,
                toneMapped: false,
              }),
            )}
          />
        ))}
      </group>
    </group>
  );
}

/* ── encrypted packet: globe → cluster → back, scroll-scrubbed ─ */
function Packet() {
  const mesh = useRef<THREE.Mesh>(null);
  const trail = useRef<THREE.Mesh>(null);
  const curve = useMemo(() => {
    const start = new THREE.Vector3(R * 0.8, R * 0.5, R * 0.4);
    const end = new THREE.Vector3(4.3, 0.2, 0);
    const mid = new THREE.Vector3(2.6, 2.4, 1.4);
    return new THREE.CatmullRomCurve3([start, mid, end]);
  }, []);

  useFrame((state) => {
    const p = scrollState.progress;
    const m = mesh.current;
    if (!m) return;
    // outbound 0.18→0.5, dwell, return 0.62→0.9
    let t = -1;
    let returning = false;
    if (p >= 0.18 && p <= 0.5) t = (p - 0.18) / 0.32;
    else if (p > 0.5 && p < 0.62) t = 1;
    else if (p >= 0.62 && p <= 0.9) {
      t = 1 - (p - 0.62) / 0.28;
      returning = true;
    }
    const visible = t >= 0;
    m.visible = visible;
    if (trail.current) trail.current.visible = visible;
    if (!visible) return;
    const pos = curve.getPoint(THREE.MathUtils.clamp(t, 0, 1));
    m.position.copy(pos);
    m.rotation.x += 0.05;
    m.rotation.y += 0.06;
    const mat = m.material as THREE.MeshStandardMaterial;
    mat.emissive = returning ? CYAN : LAV;
    if (trail.current) {
      trail.current.position.copy(pos);
      trail.current.scale.setScalar(0.5 + 0.3 * Math.sin(state.clock.elapsedTime * 6));
    }
  });

  return (
    <group>
      <mesh ref={mesh} visible={false}>
        <octahedronGeometry args={[0.28, 0]} />
        <meshStandardMaterial color={"#0b1040"} emissive={LAV} emissiveIntensity={2.2} roughness={0.2} metalness={0.7} />
      </mesh>
      <mesh ref={trail} visible={false}>
        <sphereGeometry args={[0.5, 16, 16]} />
        <meshBasicMaterial color={GLOW} transparent opacity={0.12} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
    </group>
  );
}

/* ── camera rig driven by scroll + pointer ───────────────── */
function Rig() {
  const { camera } = useThree();
  useFrame((state, dt) => {
    const p = scrollState.progress;
    const { lerp, smoothstep } = THREE.MathUtils;
    // pan toward the cluster, then pull back so globe + cluster both frame for "verify"
    const push = smoothstep(p, 0.0, 0.45); // dolly in during encrypt/compute
    const pull = smoothstep(p, 0.5, 1.0); // pull back during verify
    const camX = lerp(0, 2.2, smoothstep(p, 0.12, 0.55));
    const camZ = 10.5 - push * 1.0 + pull * 2.4;
    const camY = lerp(0, 0.5, smoothstep(p, 0.6, 1.0));
    const px = state.pointer.x * 0.55;
    const py = state.pointer.y * 0.35;
    camera.position.x = damp(camera.position.x, camX + px, 3, dt);
    camera.position.y = damp(camera.position.y, camY + py, 3, dt);
    camera.position.z = damp(camera.position.z, camZ, 3, dt);
    camera.lookAt(lerp(0, 2.2, smoothstep(p, 0.15, 0.55)), 0, 0);
  });
  return null;
}

function GlobeGroup() {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    const p = scrollState.progress;
    if (ref.current) {
      const s = THREE.MathUtils.lerp(1, 0.78, THREE.MathUtils.smoothstep(p, 0.3, 0.8));
      ref.current.scale.setScalar(damp(ref.current.scale.x, s, 3, dt));
    }
  });
  return (
    <group ref={ref}>
      <Globe />
    </group>
  );
}

export default function Scene() {
  return (
    <Canvas
      dpr={[1, 1.8]}
      gl={{ antialias: true, powerPreference: "high-performance", alpha: false, stencil: false, depth: true }}
      camera={{ position: [0, 0, 10.5], fov: 38 }}
      onCreated={({ scene, gl }) => {
        // Opaque navy backdrop — fixes the transparent-canvas / EffectComposer
        // alpha ping-pong that causes the whole scene to blink.
        scene.background = NAVY.clone();
        scene.fog = new THREE.FogExp2(NAVY.getHex(), 0.02);
        gl.setClearColor(NAVY, 1);
      }}
    >
      <ambientLight intensity={0.4} />
      <pointLight position={[6, 4, 6]} intensity={120} color={BLUE} distance={40} />
      <pointLight position={[-6, -2, 4]} intensity={90} color={PURPLE} distance={40} />
      <pointLight position={[8, 0, 2]} intensity={60} color={CYAN} distance={30} />
      <Rig />
      <GlobeGroup />
      <ServerCluster />
      <Packet />
      <EffectComposer multisampling={0}>
        <Bloom intensity={0.9} luminanceThreshold={0.45} luminanceSmoothing={0.9} mipmapBlur radius={0.55} />
        <Vignette eskil={false} offset={0.25} darkness={0.8} />
      </EffectComposer>
    </Canvas>
  );
}
