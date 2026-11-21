// The carriage window frame, fixed to the camera.
// createFrame(THREE) -> { object3d, resize(aspect, fovDeg), update(time, shake) }
// Placeholder: four dark bars. The real frame replaces it behind the same interface.
export function createFrame(THREE) {
  const object3d = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0x15130f });
  const bars = [0, 1, 2, 3].map(() => { const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat); m.renderOrder = 1000; object3d.add(m); return m; });
  const D = 0.6; // metres in front of the eye
  function resize(aspect, fovDeg) {
    const h = 2 * D * Math.tan((fovDeg * Math.PI) / 360), w = h * aspect, t = h * 0.07;
    bars[0].scale.set(w, t, 1); bars[0].position.set(0, h / 2 - t / 2, -D);
    bars[1].scale.set(w, t * 1.4, 1); bars[1].position.set(0, -h / 2 + t * 0.7, -D);
    bars[2].scale.set(t, h, 1); bars[2].position.set(-w / 2 + t / 2, 0, -D);
    bars[3].scale.set(t, h, 1); bars[3].position.set(w / 2 - t / 2, 0, -D);
  }
  return { object3d, resize, update() {} };
}
