// What will draw the train window? Asked once, before the listener starts, so the start screen can
// say so when the answer is "nothing" or "the processor" (a browser with hardware acceleration
// switched off or blocked, a remote desktop, a virtual machine). The view needs a real graphics
// card: drawn in software it manages a frame every few seconds at best.
const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|warp/i;

export function probeGraphics(doc = (typeof document !== 'undefined' ? document : null)) {
  const out = { webgl2: false, software: false, renderer: '' };
  if (!doc) return out;
  try {
    const gl = doc.createElement('canvas').getContext('webgl2');
    if (!gl) return out;
    out.webgl2 = true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    out.renderer = String((ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || '');
    // A browser refuses this context when all it has is a software renderer (or a driver it
    // distrusts enough to expect one to be much slower than it should be).
    let caveat = false;
    try { caveat = !doc.createElement('canvas').getContext('webgl2', { failIfMajorPerformanceCaveat: true }); } catch { caveat = true; }
    out.software = caveat || SOFTWARE.test(out.renderer);
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
  } catch { /* leave what was learned */ }
  return out;
}
