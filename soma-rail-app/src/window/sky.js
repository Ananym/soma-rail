// Sky: a full-screen shader behind everything, plus the light it implies for the land.
// createSky(THREE) -> { object3d, update(state), horizonColor, lightTint, sunDir }
//   state = { hour (0..24), level (0|1), dials, time (seconds), dt, aspect, fovDeg, travelled (m), speed (m/s), energy (0..1) }
//   horizonColor: THREE.Color the land hazes toward; lightTint: THREE.Color multiplied into splats.
// This is a placeholder gradient; the real sky replaces it behind the same interface.
export function createSky(THREE) {
  const uniforms = { uTop: { value: new THREE.Color(0.25, 0.45, 0.8) }, uHorizon: { value: new THREE.Color(0.72, 0.8, 0.88) } };
  const material = new THREE.ShaderMaterial({
    uniforms, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 1.0, 1.0); }',
    fragmentShader: 'varying vec2 vUv; uniform vec3 uTop; uniform vec3 uHorizon; void main() { float t = smoothstep(0.45, 1.0, vUv.y); gl_FragColor = vec4(mix(uHorizon, uTop, t), 1.0); }',
  });
  const object3d = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  object3d.frustumCulled = false; object3d.renderOrder = -1000;
  const horizonColor = uniforms.uHorizon.value.clone(), lightTint = new THREE.Color(1, 1, 1), sunDir = new THREE.Vector3(0.3, 0.6, -0.7).normalize();
  return { object3d, horizonColor, lightTint, sunDir, update() {} };
}
