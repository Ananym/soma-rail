// A deliberately plain biome: green ground with scattered blobs. It exists so the engine can run
// before the real biomes are written, and as the smallest example of the generator contract.
function* ground(ctx, emit) {
  const { rng, length, zNear, zFar, count, terrain, x0, palette } = ctx;
  for (let i = 0; i < count; i++) {
    // log-spaced in depth so near ground is not starved
    const dist = zNear * Math.pow(zFar / zNear, rng());
    const x = rng() * length;
    const tall = rng() < 0.08;
    const size = 0.012 * dist + 0.08;
    const y = terrain.height(x0 + x, dist) + (tall ? rng.range(1, 9) * Math.min(1, dist / 40) : 0);
    const c = tall ? palette.foliage : palette.ground;
    const k = 0.8 + 0.4 * rng();
    emit(x, y, -dist, size * 1.6, tall ? size * 1.4 : size * 0.35, size * 1.6, c[0] * k, c[1] * k, c[2] * k, 0.9);
    if (i % 400 === 0) yield;
  }
}

export const placeholderBiome = {
  name: 'placeholder',
  palette: { ground: [0.33, 0.45, 0.2], foliage: [0.13, 0.3, 0.12], rock: [0.4, 0.4, 0.42] },
  terrain: {},
  hazeDist: 3200,
  generators: { trackside: ground, near: ground, mid: ground, far: ground },
};
