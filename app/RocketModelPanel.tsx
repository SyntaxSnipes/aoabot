"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

const MODEL_PATHS = {
  v1: "/models/rocket-v1.glb?v=1",
  v2: "/models/rocket-v2.glb?v=2",
} as const;

type Version = keyof typeof MODEL_PATHS;

class ViewerErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    // Keep WebGL/model failures contained to this panel.
  }

  render() {
    return this.state.failed ? <div className="model-placeholder">3D view unavailable</div> : this.props.children;
  }
}

type ModelInfo = {
  scene: THREE.Group;
  bounds: THREE.Box3;
  size: THREE.Vector3;
  center: THREE.Vector3;
};

function inspectModel(version: Version, scene: THREE.Group): ModelInfo {
  scene.updateMatrixWorld(true);
  let meshCount = 0;
  let cameraCount = 0;
  let lightCount = 0;
  let emptyCount = 0;
  const bounds = new THREE.Box3();
  scene.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      meshCount += 1;
      const meshBounds = new THREE.Box3().setFromObject(node);
      bounds.union(meshBounds);
    } else if (node instanceof THREE.Camera) {
      cameraCount += 1;
    } else if (node instanceof THREE.Light) {
      lightCount += 1;
    } else {
      emptyCount += 1;
    }
  });
  const nodeCount = meshCount + cameraCount + lightCount + emptyCount;
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const valid = bounds.isEmpty() || ![...size, ...center].every(Number.isFinite) ? false : true;
  console.info(`[RocketModel] ${JSON.stringify({
    url: MODEL_PATHS[version],
    nodes: nodeCount,
    mesh: meshCount,
    camera: cameraCount,
    light: lightCount,
    empty: emptyCount,
    min: bounds.min.toArray(),
    max: bounds.max.toArray(),
    size: size.toArray(),
  })}`);
  if (!valid) {
    throw new Error(`Invalid mesh bounds for ${MODEL_PATHS[version]}`);
  }
  return { scene, bounds, size, center };
}

function FitModels({ version }: { version: Version }) {
  const v1 = useGLTF(MODEL_PATHS.v1).scene;
  const v2 = useGLTF(MODEL_PATHS.v2).scene;
  const models = useMemo(() => ({
    v1: inspectModel("v1", v1),
    v2: inspectModel("v2", v2),
  }), [v1, v2]);
  const largestHeight = Math.max(models.v1.size.y, models.v2.size.y);
  const active = models[version];
  const scale = 2.4 / largestHeight;
  const position: [number, number, number] = [
    -active.center.x * scale,
    -active.center.y * scale,
    -active.center.z * scale,
  ];

  useEffect(() => {
    if (!Number.isFinite(largestHeight) || largestHeight <= 0) {
      throw new Error(`Invalid shared model height for ${MODEL_PATHS[version]}`);
    }
    if (models.v1.size.y > models.v2.size.y * 3) {
      console.warn(`[RocketModel] ${MODEL_PATHS.v1} mesh height is more than 3x ${MODEL_PATHS.v2}`);
    } else if (models.v2.size.y > models.v1.size.y * 3) {
      console.warn(`[RocketModel] ${MODEL_PATHS.v2} mesh height is more than 3x ${MODEL_PATHS.v1}`);
    }
  }, [largestHeight, models, version]);

  return <group position={position} scale={scale}><primitive object={active.scene} /></group>;
}

function ViewerScene({ version, autoRotate, onInteract }: { version: Version; autoRotate: boolean; onInteract: () => void }) {
  const controls = useRef<OrbitControlsImpl>(null);

  useEffect(() => {
    const reset = () => controls.current?.reset();
    window.addEventListener("aoabot-reset-model-view", reset);
    return () => window.removeEventListener("aoabot-reset-model-view", reset);
  }, []);

  return (
    <>
      <ambientLight intensity={1.6} />
      <directionalLight position={[4, 5, 6]} intensity={3} />
      <directionalLight position={[-3, 1, -4]} intensity={1} />
      <Suspense fallback={null}>
        <FitModels version={version} />
      </Suspense>
      <OrbitControls
        ref={controls}
        makeDefault
        enablePan
        enableZoom
        enableRotate
        minDistance={2.2}
        maxDistance={8}
        autoRotate={autoRotate}
        autoRotateSpeed={0.7}
        onStart={onInteract}
      />
    </>
  );
}

function VisibilityCanvas({
  version,
  active,
  onInteract,
  autoRotate,
}: {
  version: Version;
  active: boolean;
  autoRotate: boolean;
  onInteract: () => void;
}) {
  return (
    <Canvas
      camera={{ position: [3.8, 2.4, 4.8], fov: 38, near: 0.1, far: 100 }}
      dpr={[1, 2]}
      frameloop={active ? "always" : "never"}
      gl={{ alpha: false, antialias: true }}
      onCreated={({ gl }) => gl.setClearColor("#1A1F1C", 1)}
    >
      <ViewerScene version={version} autoRotate={autoRotate} onInteract={onInteract} />
    </Canvas>
  );
}

export default function RocketModelPanel() {
  const [version, setVersion] = useState<Version>("v2");
  const [available, setAvailable] = useState<boolean | null>(null);
  const [visible, setVisible] = useState(true);
  const [autoRotate, setAutoRotate] = useState(true);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all(Object.values(MODEL_PATHS).map(async (path) => {
      try {
        const response = await fetch(path, { method: "HEAD" });
        return response.ok;
      } catch {
        return false;
      }
    })).then((results) => {
      if (!cancelled) {
        const allAvailable = results.every(Boolean);
        setAvailable(allAvailable);
        if (allAvailable) {
          useGLTF.preload(MODEL_PATHS.v1);
          useGLTF.preload(MODEL_PATHS.v2);
        }
      }
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const element = panelRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.01 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function resetView() {
    setAutoRotate(true);
    window.dispatchEvent(new CustomEvent("aoabot-reset-model-view"));
  }

  function selectVersion(nextVersion: Version) {
    setVersion(nextVersion);
  }

  return (
    <div className="info-card model-card" ref={panelRef}>
      <div className="card-heading">
        <div><p className="eyebrow">ROCKET MODEL</p><h2>Rocket model · {version}</h2></div>
        <div className="model-toggle" role="group" aria-label="Rocket model version">
          {(["v1", "v2"] as const).map((option) => (
            <button
              type="button"
              key={option}
              className={option === version ? "active" : ""}
              aria-pressed={option === version}
              onClick={() => selectVersion(option)}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                  event.preventDefault();
                  selectVersion(option === "v1" ? "v2" : "v1");
                }
              }}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
      <div className="model-viewport">
        {available === null && <div className="model-placeholder">Loading model…</div>}
        {available === false && <div className="model-placeholder">Model files not added yet</div>}
        {available === true && (
          <ViewerErrorBoundary>
            <VisibilityCanvas version={version} active={visible} autoRotate={autoRotate} onInteract={() => setAutoRotate(false)} />
          </ViewerErrorBoundary>
        )}
      </div>
      <div className="model-footer">
        <span>Drag to rotate. Scroll or pinch to zoom.</span>
        {available && <button type="button" onClick={resetView}>Reset view</button>}
      </div>
      <small className="model-disclaimer">Models show simplified geometry and are not manufacturing or flight-certified representations.</small>
    </div>
  );
}
