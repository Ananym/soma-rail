<template>
  <div class="request-comparison">
    <h3>Request Header Comparison Tool</h3>

    <div class="instructions">
      <p><strong>How to use:</strong></p>
      <ol>
        <li>Open Soma FM popup player in a new tab</li>
        <li>Open browser DevTools (F12) → Network tab</li>
        <li>Find the .mp3 stream request</li>
        <li>Copy the Request Headers from that tab</li>
        <li>Paste below and click "Compare"</li>
      </ol>
    </div>

    <div class="section">
      <h4>Our App's Request Headers (Actual)</h4>
      <button @click="captureOurHeaders">Capture Our Request</button>
      <pre v-if="ourHeaders">{{ ourHeaders }}</pre>
    </div>

    <div class="section">
      <h4>Soma FM Popup Headers (paste here)</h4>
      <textarea
        v-model="somaPopupHeaders"
        placeholder="Paste the working request headers from Soma FM popup..."
        rows="10"
      ></textarea>
    </div>

    <button @click="compareHeaders" class="compare-btn">Compare Differences</button>

    <div v-if="differences" class="differences">
      <h4>Key Differences:</h4>
      <pre>{{ differences }}</pre>
    </div>

    <div class="test-section">
      <h4>Test Different Approaches</h4>

      <div class="test-option">
        <button @click="testNoCrossorigin">Test Without crossorigin</button>
        <span v-if="noCrossoriginResult" :class="noCrossoriginResult.status">
          {{ noCrossoriginResult.message }}
        </span>
      </div>

      <div class="test-option">
        <button @click="testDirectFetch">Test Direct Fetch (no audio element)</button>
        <span v-if="directFetchResult" :class="directFetchResult.status">
          {{ directFetchResult.message }}
        </span>
      </div>

      <div class="test-option">
        <button @click="testWithReferrer">Test With Soma FM Referrer</button>
        <span v-if="referrerResult" :class="referrerResult.status">
          {{ referrerResult.message }}
        </span>
      </div>

      <div class="test-option">
        <label>
          Custom User-Agent:
          <input v-model="customUserAgent" type="text" placeholder="Mozilla/5.0...">
        </label>
        <button @click="testCustomUA">Test Custom UA</button>
        <span v-if="customUAResult" :class="customUAResult.status">
          {{ customUAResult.message }}
        </span>
      </div>
    </div>

    <div class="audio-test">
      <h4>Live Test Audio Elements:</h4>
      <div class="audio-item">
        <label>With crossorigin="anonymous":</label>
        <audio ref="audioWithCors" controls crossorigin="anonymous"></audio>
      </div>
      <div class="audio-item">
        <label>Without crossorigin:</label>
        <audio ref="audioNoCors" controls></audio>
      </div>
      <div class="audio-item">
        <label>With use-credentials:</label>
        <audio ref="audioWithCreds" controls crossorigin="use-credentials"></audio>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';

const ourHeaders = ref(null);
const somaPopupHeaders = ref('');
const differences = ref(null);
const customUserAgent = ref('');

const noCrossoriginResult = ref(null);
const directFetchResult = ref(null);
const referrerResult = ref(null);
const customUAResult = ref(null);

const audioWithCors = ref(null);
const audioNoCors = ref(null);
const audioWithCreds = ref(null);

const testStreamUrl = 'https://ice3.somafm.com/groovesalad-128-mp3';

function captureOurHeaders() {
  // This is what the browser sends with crossorigin="anonymous"
  ourHeaders.value = `
[Typical Browser Request with crossorigin="anonymous"]
GET /groovesalad-128-mp3 HTTP/1.1
Host: ice3.somafm.com
Origin: ${window.location.origin}
Referer: ${window.location.href}
User-Agent: ${navigator.userAgent}
Accept: */*
Accept-Encoding: gzip, deflate, br
Accept-Language: ${navigator.language}
Connection: keep-alive
Sec-Fetch-Mode: cors
Sec-Fetch-Site: cross-site
Sec-Fetch-Dest: audio
  `.trim();
}

function compareHeaders() {
  if (!somaPopupHeaders.value) {
    differences.value = 'Please paste Soma FM popup headers first';
    return;
  }

  // Simple comparison - look for key differences
  const keyHeaders = ['User-Agent', 'Referer', 'Origin', 'Sec-Fetch', 'Range', 'Icy-MetaData'];
  const diffs = [];

  keyHeaders.forEach(header => {
    const inPopup = somaPopupHeaders.value.toLowerCase().includes(header.toLowerCase());
    const inOurs = ourHeaders.value?.toLowerCase().includes(header.toLowerCase());

    if (inPopup !== inOurs) {
      diffs.push(`${header}: Popup=${inPopup}, Ours=${inOurs}`);
    }
  });

  differences.value = diffs.length > 0
    ? diffs.join('\n')
    : 'No obvious differences in key headers';
}

async function testNoCrossorigin() {
  noCrossoriginResult.value = { status: 'testing', message: 'Testing...' };

  try {
    if (audioNoCors.value) {
      audioNoCors.value.src = testStreamUrl;

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);

        audioNoCors.value.addEventListener('loadeddata', () => {
          clearTimeout(timeout);
          resolve();
        }, { once: true });

        audioNoCors.value.addEventListener('error', (e) => {
          clearTimeout(timeout);
          reject(new Error(`Error code: ${audioNoCors.value.error?.code}`));
        }, { once: true });

        audioNoCors.value.load();
      });

      noCrossoriginResult.value = {
        status: 'success',
        message: '✅ Works without crossorigin!'
      };
    }
  } catch (error) {
    noCrossoriginResult.value = {
      status: 'error',
      message: `❌ ${error.message}`
    };
  }
}

async function testDirectFetch() {
  directFetchResult.value = { status: 'testing', message: 'Testing...' };

  try {
    const response = await fetch(testStreamUrl, {
      method: 'GET',
      mode: 'no-cors'
    });

    directFetchResult.value = {
      status: 'success',
      message: `✅ Fetch succeeded (opaque response)`
    };
  } catch (error) {
    directFetchResult.value = {
      status: 'error',
      message: `❌ ${error.message}`
    };
  }
}

async function testWithReferrer() {
  referrerResult.value = { status: 'testing', message: 'Testing...' };

  try {
    // Try with somafm.com as referrer
    const response = await fetch(testStreamUrl, {
      method: 'HEAD',
      referrer: 'https://somafm.com/',
      referrerPolicy: 'unsafe-url'
    });

    referrerResult.value = {
      status: response.ok ? 'success' : 'warning',
      message: `${response.ok ? '✅' : '⚠️'} Status: ${response.status}`
    };
  } catch (error) {
    referrerResult.value = {
      status: 'error',
      message: `❌ ${error.message}`
    };
  }
}

async function testCustomUA() {
  customUAResult.value = { status: 'info', message: 'Note: Cannot change User-Agent via fetch API in browsers' };
}

function loadAllTestAudio() {
  if (audioWithCors.value) {
    audioWithCors.value.src = testStreamUrl;
  }
  if (audioNoCors.value) {
    audioNoCors.value.src = testStreamUrl;
  }
  if (audioWithCreds.value) {
    audioWithCreds.value.src = testStreamUrl;
  }
}

defineExpose({
  loadAllTestAudio
});
</script>

<style scoped>
.request-comparison {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: rgba(0, 0, 0, 0.95);
  border: 2px solid #66d9ef;
  border-radius: 12px;
  padding: 20px;
  color: #fff;
  font-family: monospace;
  font-size: 12px;
  max-width: 800px;
  max-height: 90vh;
  overflow-y: auto;
  z-index: 10000;
}

h3 {
  margin: 0 0 15px 0;
  color: #66d9ef;
  font-size: 18px;
}

h4 {
  margin: 15px 0 8px 0;
  color: #a6e22e;
  font-size: 14px;
}

.instructions {
  background: rgba(255, 255, 255, 0.05);
  padding: 10px;
  border-radius: 6px;
  margin-bottom: 15px;
}

.instructions ol {
  margin: 5px 0;
  padding-left: 20px;
}

.section {
  margin: 15px 0;
  padding: 10px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 6px;
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

button.compare-btn {
  background: #a6e22e;
  width: 100%;
  padding: 12px;
  font-size: 14px;
}

textarea {
  width: 100%;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 4px;
  padding: 8px;
  font-family: monospace;
  font-size: 11px;
}

pre {
  background: rgba(0, 0, 0, 0.5);
  padding: 10px;
  border-radius: 4px;
  overflow-x: auto;
  font-size: 10px;
  line-height: 1.4;
}

.differences {
  margin: 15px 0;
  padding: 10px;
  background: rgba(255, 184, 0, 0.1);
  border: 1px solid #ffb800;
  border-radius: 6px;
}

.test-section {
  margin: 20px 0;
  padding: 15px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 6px;
}

.test-option {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 10px 0;
}

.test-option input {
  flex: 1;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 4px;
  padding: 6px;
  font-family: monospace;
  font-size: 11px;
}

.test-option label {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}

.success {
  color: #a6e22e;
}

.error {
  color: #ff6b6b;
}

.warning {
  color: #ffb800;
}

.info {
  color: #66d9ef;
}

.testing {
  color: #999;
}

.audio-test {
  margin: 20px 0;
  padding: 15px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 6px;
}

.audio-item {
  margin: 10px 0;
}

.audio-item label {
  display: block;
  margin-bottom: 5px;
  color: #a6e22e;
}

.audio-item audio {
  width: 100%;
  height: 30px;
}
</style>
