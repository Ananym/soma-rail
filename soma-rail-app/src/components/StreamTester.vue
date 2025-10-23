<template>
  <div class="stream-tester">
    <h2>Soma FM Stream Tester</h2>
    <p>Systematically test what makes streams work</p>

    <div class="test-grid">
      <div class="test-section">
        <h3>Test 1: Direct Link in New Tab</h3>
        <button @click="openInNewTab">Open Stream URL Directly</button>
        <p class="instruction">Does audio play in the new tab?</p>
      </div>

      <div class="test-section">
        <h3>Test 2: Plain Audio Element</h3>
        <button @click="testPlainAudio">Test Plain Audio</button>
        <audio ref="plainAudio" controls style="width: 100%; margin-top: 10px;"></audio>
        <div v-if="plainResult" :class="'result ' + plainResult.status">
          {{ plainResult.message }}
        </div>
      </div>

      <div class="test-section">
        <h3>Test 3: Different Servers</h3>
        <div v-for="server in ['ice1', 'ice3', 'ice4', 'ice5', 'ice6']" :key="server" class="server-test">
          <button @click="testServer(server)">Test {{ server }}</button>
          <span v-if="serverResults[server]" :class="'result-inline ' + serverResults[server].status">
            {{ serverResults[server].message }}
          </span>
        </div>
      </div>

      <div class="test-section">
        <h3>Test 4: Different Formats</h3>
        <button @click="testAAC">Test AAC Format</button>
        <button @click="testMP3Low">Test MP3 Low Quality</button>
        <audio ref="formatAudio" controls style="width: 100%; margin-top: 10px;"></audio>
        <div v-if="formatResult" :class="'result ' + formatResult.status">
          {{ formatResult.message }}
        </div>
      </div>

      <div class="test-section">
        <h3>Test 5: Embedded Player from Soma FM</h3>
        <button @click="loadEmbedPlayer">Load Official Embed</button>
        <div id="soma-embed" style="margin-top: 10px;"></div>
        <p class="instruction">Check if official embed works</p>
      </div>

      <div class="test-section">
        <h3>Test 6: iframe with Soma FM URL</h3>
        <button @click="loadIframe">Load in iframe</button>
        <iframe
          v-if="showIframe"
          ref="testIframe"
          style="width: 100%; height: 60px; border: 1px solid #666; margin-top: 10px;"
        ></iframe>
        <p class="instruction">Does it work in an iframe?</p>
      </div>

      <div class="test-section">
        <h3>Test 7: Check Actual Headers Being Sent</h3>
        <button @click="captureRequest">Make Request & Log Headers</button>
        <pre v-if="capturedHeaders" class="headers-display">{{ capturedHeaders }}</pre>
      </div>

      <div class="test-section">
        <h3>Test 8: M3U Playlist Instead of PLS</h3>
        <button @click="testM3U">Test M3U Playlist</button>
        <audio ref="m3uAudio" controls style="width: 100%; margin-top: 10px;"></audio>
        <div v-if="m3uResult" :class="'result ' + m3uResult.status">
          {{ m3uResult.message }}
        </div>
      </div>
    </div>

    <div class="summary">
      <h3>Working Hypothesis:</h3>
      <p v-if="hypothesis">{{ hypothesis }}</p>
      <p v-else>Run tests to determine what's required...</p>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';

const plainAudio = ref(null);
const formatAudio = ref(null);
const m3uAudio = ref(null);
const testIframe = ref(null);

const plainResult = ref(null);
const formatResult = ref(null);
const m3uResult = ref(null);
const serverResults = ref({});
const showIframe = ref(false);
const capturedHeaders = ref(null);
const hypothesis = ref(null);

const testChannel = 'groovesalad';
const testFormat = '128-mp3';

function openInNewTab() {
  const url = `https://ice3.somafm.com/${testChannel}-${testFormat}`;
  window.open(url, '_blank');
  hypothesis.value = 'If this plays, direct URLs work in browser but not in our audio element';
}

async function testPlainAudio() {
  plainResult.value = { status: 'testing', message: 'Testing...' };

  const url = `https://ice3.somafm.com/${testChannel}-${testFormat}`;

  try {
    plainAudio.value.src = url;

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout after 5s')), 5000);

      plainAudio.value.addEventListener('loadeddata', () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });

      plainAudio.value.addEventListener('error', (e) => {
        clearTimeout(timeout);
        const code = plainAudio.value.error?.code;
        const message = plainAudio.value.error?.message || 'Unknown error';
        reject(new Error(`Error code ${code}: ${message}`));
      }, { once: true });

      plainAudio.value.load();
    });

    plainResult.value = {
      status: 'success',
      message: '✅ Plain audio element works! Issue must be in our implementation.'
    };

    hypothesis.value = 'Plain audio elements can load the stream. Our code has unnecessary complexity.';

  } catch (error) {
    plainResult.value = {
      status: 'error',
      message: `❌ ${error.message}`
    };

    hypothesis.value = 'Even plain audio fails. Issue is browser/network level.';
  }
}

async function testServer(server) {
  serverResults.value[server] = { status: 'testing', message: 'Testing...' };

  const url = `https://${server}.somafm.com/${testChannel}-${testFormat}`;
  const audio = new Audio();

  try {
    audio.src = url;

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout')), 3000);

      audio.addEventListener('loadeddata', () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });

      audio.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new Error(`Code: ${audio.error?.code}`));
      }, { once: true });

      audio.load();
    });

    serverResults.value[server] = {
      status: 'success',
      message: '✅ Works!'
    };

    hypothesis.value = `Server ${server} works! Use this one by default.`;

  } catch (error) {
    serverResults.value[server] = {
      status: 'error',
      message: `❌ ${error.message}`
    };
  }
}

async function testAAC() {
  formatResult.value = { status: 'testing', message: 'Testing AAC...' };

  // AAC streams typically have different URLs
  const url = `https://ice3.somafm.com/${testChannel}-64-aac`;

  try {
    formatAudio.value.src = url;

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);

      formatAudio.value.addEventListener('loadeddata', () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });

      formatAudio.value.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new Error(`Error: ${formatAudio.value.error?.code}`));
      }, { once: true });

      formatAudio.value.load();
    });

    formatResult.value = {
      status: 'success',
      message: '✅ AAC works! Use AAC instead of MP3.'
    };

    hypothesis.value = 'AAC format works where MP3 fails. Switch to AAC streams.';

  } catch (error) {
    formatResult.value = {
      status: 'error',
      message: `❌ ${error.message}`
    };
  }
}

async function testMP3Low() {
  formatResult.value = { status: 'testing', message: 'Testing MP3 low quality...' };

  const url = `https://ice3.somafm.com/${testChannel}-64-mp3`;

  try {
    formatAudio.value.src = url;

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);

      formatAudio.value.addEventListener('loadeddata', () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });

      formatAudio.value.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new Error(`Error: ${formatAudio.value.error?.code}`));
      }, { once: true });

      formatAudio.value.load();
    });

    formatResult.value = {
      status: 'success',
      message: '✅ Low quality MP3 works!'
    };

  } catch (error) {
    formatResult.value = {
      status: 'error',
      message: `❌ ${error.message}`
    };
  }
}

function loadEmbedPlayer() {
  const embedHTML = `
    <iframe src="https://somafm.com/player/#/now-playing/groovesalad"
            width="100%"
            height="200"
            frameborder="0">
    </iframe>
  `;

  document.getElementById('soma-embed').innerHTML = embedHTML;
  hypothesis.value = 'If official embed works, we should use their player URL scheme.';
}

function loadIframe() {
  showIframe.value = true;
  setTimeout(() => {
    if (testIframe.value) {
      testIframe.value.src = `https://ice3.somafm.com/${testChannel}-${testFormat}`;
      hypothesis.value = 'Testing if iframe context makes a difference.';
    }
  }, 100);
}

async function captureRequest() {
  capturedHeaders.value = 'Fetching...';

  try {
    const url = `https://ice3.somafm.com/${testChannel}-${testFormat}`;

    // This will fail with CORS, but we can see what was sent in Network tab
    const response = await fetch(url, { method: 'HEAD' });

    capturedHeaders.value = `Status: ${response.status}\n`;
    capturedHeaders.value += `Check Network tab in DevTools for full request headers`;

  } catch (error) {
    capturedHeaders.value = `Error: ${error.message}\n\nCheck Network tab in DevTools to see actual request headers`;
  }
}

async function testM3U() {
  m3uResult.value = { status: 'testing', message: 'Testing M3U...' };

  // Try M3U format
  const url = `https://somafm.com/${testChannel}.m3u`;

  try {
    m3uAudio.value.src = url;

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);

      m3uAudio.value.addEventListener('loadeddata', () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });

      m3uAudio.value.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new Error(`Error: ${m3uAudio.value.error?.code}`));
      }, { once: true });

      m3uAudio.value.load();
    });

    m3uResult.value = {
      status: 'success',
      message: '✅ M3U works! Use M3U URLs instead of parsing PLS.'
    };

    hypothesis.value = 'M3U playlists work directly. Skip PLS parsing, use .m3u URLs.';

  } catch (error) {
    m3uResult.value = {
      status: 'error',
      message: `❌ ${error.message}`
    };
  }
}
</script>

<style scoped>
.stream-tester {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: rgba(0, 0, 0, 0.95);
  border: 2px solid #ff6b6b;
  border-radius: 12px;
  padding: 20px;
  color: #fff;
  max-width: 900px;
  max-height: 90vh;
  overflow-y: auto;
  z-index: 10001;
}

h2 {
  margin: 0 0 10px 0;
  color: #ff6b6b;
}

h3 {
  margin: 10px 0 8px 0;
  color: #a6e22e;
  font-size: 14px;
}

.test-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 15px;
  margin: 20px 0;
}

.test-section {
  background: rgba(255, 255, 255, 0.05);
  padding: 15px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

button {
  background: #66d9ef;
  color: #000;
  border: none;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  font-weight: bold;
  margin: 5px 5px 5px 0;
}

button:hover {
  background: #7ee9ff;
}

.instruction {
  font-size: 11px;
  color: #999;
  margin: 5px 0;
}

.result, .result-inline {
  margin-top: 10px;
  padding: 8px;
  border-radius: 4px;
  font-size: 11px;
}

.result-inline {
  display: inline-block;
  margin-left: 10px;
  padding: 4px 8px;
}

.result.success, .result-inline.success {
  background: rgba(166, 226, 46, 0.2);
  border: 1px solid #a6e22e;
}

.result.error, .result-inline.error {
  background: rgba(255, 107, 107, 0.2);
  border: 1px solid #ff6b6b;
}

.result.testing, .result-inline.testing {
  background: rgba(102, 217, 239, 0.2);
  border: 1px solid #66d9ef;
}

.server-test {
  margin: 5px 0;
}

.headers-display {
  background: rgba(0, 0, 0, 0.5);
  padding: 10px;
  border-radius: 4px;
  font-size: 10px;
  margin-top: 10px;
  max-height: 200px;
  overflow-y: auto;
}

.summary {
  background: rgba(255, 184, 0, 0.1);
  border: 2px solid #ffb800;
  border-radius: 8px;
  padding: 15px;
  margin-top: 20px;
}

.summary h3 {
  color: #ffb800;
  margin-top: 0;
}

.summary p {
  margin: 5px 0;
  font-weight: bold;
}
</style>
