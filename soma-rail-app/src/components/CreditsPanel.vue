<template>
  <div class="credits-backdrop" @click.self="$emit('close')">
    <div class="credits" role="dialog" aria-modal="true" aria-labelledby="credits-title">
      <button type="button" class="close" aria-label="Close credits" @click="$emit('close')">Close</button>
      <h2 id="credits-title">Credits and sources</h2>

      <h3>Music</h3>
      <p>
        Every channel is streamed live from <a href="https://somafm.com/" target="_blank" rel="noopener">SomaFM</a>,
        listener-supported, commercial-free radio. Channel and track information come from SomaFM too.
        If you enjoy it, please <a href="https://somafm.com/support/" target="_blank" rel="noopener">support them</a>.
      </p>

      <h3>Scenery</h3>
      <p>
        The view is generated in your browser as you watch, by this project's own code: the land, the sky
        and the traffic are drawn, not photographed or recorded.
      </p>
      <p>
        The exception is a few photographic pieces in the farmland, made from public-domain (CC0) panoramas
        on <a href="https://polyhaven.com/" target="_blank" rel="noopener">Poly Haven</a>:
      </p>
      <ul>
        <li v-for="p in pieces" :key="p.id">
          <a v-if="p.sourceUrl" :href="p.sourceUrl" target="_blank" rel="noopener">{{ p.attribution }}</a>
          <span v-else>{{ p.attribution }}</span>
        </li>
        <li v-if="!pieces.length">{{ piecesNote }}</li>
      </ul>
      <p>
        Their depth was estimated with
        <a href="https://github.com/DepthAnything/Depth-Anything-V2" target="_blank" rel="noopener">Depth Anything V2</a>
        (Small, Apache 2.0).
      </p>

      <h3>Software</h3>
      <ul>
        <li><a href="https://sparkjs.dev/" target="_blank" rel="noopener">Spark</a>, the Gaussian splat renderer, by World Labs</li>
        <li><a href="https://threejs.org/" target="_blank" rel="noopener">three.js</a></li>
        <li><a href="https://vuejs.org/" target="_blank" rel="noopener">Vue</a> and <a href="https://vite.dev/" target="_blank" rel="noopener">Vite</a></li>
      </ul>
    </div>
  </div>
</template>

<script setup>
// Who and what the app is made from. Opened from the overlay; stays until closed.
import { ref, onMounted, onUnmounted } from 'vue';

const emit = defineEmits(['close']);
const pieces = ref([]);
const piecesNote = ref('loading the list');

function onKey(e) { if (e.key === 'Escape') emit('close'); }

onMounted(async () => {
  window.addEventListener('keydown', onKey);
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}kit/index.json`);
    if (!r.ok) throw new Error(r.status);
    const d = await r.json();
    pieces.value = (d.pieces || []).filter((p) => p.attribution);
    if (!pieces.value.length) piecesNote.value = 'none listed';
  } catch {
    piecesNote.value = 'The list could not be loaded; the sources are recorded in public/kit/index.json.';
  }
});
onUnmounted(() => window.removeEventListener('keydown', onKey));
</script>

<style scoped>
.credits-backdrop {
  position: fixed;
  inset: 0;
  z-index: 500;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(0, 0, 0, 0.45);
}
.credits {
  position: relative;
  width: min(620px, 100%);
  max-height: min(80vh, 720px);
  overflow-y: auto;
  background: rgba(0, 0, 0, 0.9);
  backdrop-filter: blur(10px);
  border-radius: 12px;
  padding: 22px 26px 24px;
  color: rgba(255, 255, 255, 0.88);
  font-size: 14px;
  line-height: 1.5;
}
h2 { margin: 0 70px 12px 0; font-size: 20px; font-weight: 500; color: #fff; }
h3 { margin: 18px 0 6px; font-size: 13px; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(255, 255, 255, 0.6); }
p { margin: 0 0 8px; }
ul { margin: 0 0 8px; padding-left: 20px; }
li { margin: 2px 0; }
a { color: #66d9ef; text-decoration: underline; text-underline-offset: 2px; }
a:hover { color: #a6e22e; }
.close {
  position: absolute;
  top: 18px;
  right: 20px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.35);
  color: #fff;
  border-radius: 6px;
  padding: 4px 12px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.close:hover { background: rgba(255, 255, 255, 0.2); border-color: rgba(255, 255, 255, 0.7); }
.close:focus-visible, a:focus-visible { outline: 2px solid #66d9ef; outline-offset: 2px; }
</style>
