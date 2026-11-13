"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import { Component, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

const MODEL_PATHS = {
  v1: "/models/rocket-v1.glb",
  v2: "/models/rocket-v2.glb",
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

function FitModel({ path }: { path: string }) {
  const { scene } = useGLTF(path);
  const group = useRef<THREE.Group>(null);

  useEffect(() => {
    const root = group.current;
    if (!root) return;
    const bounds = new THREE.Box3().setFromObject(root);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const largestSide = Math.max(size.x, size.y, size.z);
    root.scale.setScalar(largestSide > 0 ? 2.4 / largestSide : 1);
    root.position.set(-center.x, -center.y, -center.z);
  }, [scene]);

  return <group ref={group}><primitive object={scene} /></group>;
}

function ViewerScene({ path, autoRotate, onInteract }: { path: string; autoRotate: boolean; onInteract: () => void }) {
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
        <FitModel path={path} />
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
  path,
  active,
  onInteract,
  autoRotate,
}: {
  path: string;
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
      <ViewerScene path={path} autoRotate={autoRotate} onInteract={onInteract} />
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
            <VisibilityCanvas path={MODEL_PATHS[version]} active={visible} autoRotate={autoRotate} onInteract={() => setAutoRotate(false)} />
          </ViewerErrorBoundary>
        )}
      </div>
      <div className="model-footer">
        <span>Drag to rotate. Scroll or pinch to zoom.</span>
        {available && <button type="button" onClick={resetView}>Reset view</button>}
      </div>
    </div>
  );
}
