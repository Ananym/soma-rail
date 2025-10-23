<template>
  <div class="diagnostics">
    <div class="diagnostics-header">
      <h3>Audio Diagnostics</h3>
      <button @click="toggleExpanded">{{ expanded ? '−' : '+' }}</button>
    </div>

    <div v-if="expanded" class="diagnostics-content">
      <div class="section">
        <h4>Channels API</h4>
        <button @click="testChannelsAPI" :disabled="loading">Test Channels API</button>
        <div v-if="channelsResult" class="result" :class="channelsResult.status">
          <strong>Status:</strong> {{ channelsResult.status }}<br>
          <span v-if="channelsResult.message">{{ channelsResult.message }}</span>
          <span v-if="channelsResult.count">Found {{ channelsResult.count }} channels</span>
        </div>
      </div>

      <div class="section">
        <h4>PLS File Test</h4>
        <select v-model="selectedTestChannel">
          <option value="groovesalad">Groove Salad</option>
          <option value="defcon">DEF CON Radio</option>
          <option value="secretagent">Secret Agent</option>
          <option value="dronezone">Drone Zone</option>
          <option value="beatblender">Beat Blender</option>
        </select>
        <button @click="testPLS" :disabled="loading">Test PLS</button>
        <div v-if="plsResult" class="result" :class="plsResult.status">
          <strong>Status:</strong> {{ plsResult.status }}<br>
          <span v-if="plsResult.url">
            Stream URL: <code>{{ plsResult.url }}</code>
          </span>
          <span v-if="plsResult.message">{{ plsResult.message }}</span>
        </div>
      </div>

      <div class="section">
        <h4>Stream Connectivity Test</h4>
        <button @click="testStreamConnection" :disabled="loading || !plsResult?.url">
          Test Stream Connection
        </button>
        <div v-if="streamResult" class="result" :class="streamResult.status">
          <strong>Status:</strong> {{ streamResult.status }}<br>
          <span>{{ streamResult.message }}</span>
        </div>
      </div>

      <div class="section">
        <h4>Audio Element Test</h4>
        <button @click="testAudioElement" :disabled="loading || !plsResult?.url">
          Test Audio Load
        </button>
        <div v-if="audioResult" class="result" :class="audioResult.status">
          <strong>Status:</strong> {{ audioResult.status }}<br>
          <span>{{ audioResult.message }}</span>
        </div>
        <div v-if="audioTestElement" class="audio-controls">
          <audio ref="testAudio" controls></audio>
        </div>
      </div>

      <div class="section">
        <h4>Song Metadata Test</h4>
        <button @click="testMetadata" :disabled="loading">Test Metadata</button>
        <div v-if="metadataResult" class="result" :class="metadataResult.status">
          <strong>Status:</strong> {{ metadataResult.status }}<br>
          <span v-if="metadataResult.song">
            <strong>{{ metadataResult.song.title }}</strong><br>
            <em>{{ metadataResult.song.artist }}</em>
          </span>
          <span v-if="metadataResult.message">{{ metadataResult.message }}</span>
        </div>
      </div>

      <button @click="runAllTests" class="run-all" :disabled="loading">
        Run All Tests
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { fetchPLS } from '../utils/plsParser';

const expanded = ref(false);
const loading = ref(false);
const selectedTestChannel = ref('groovesalad');

const channelsResult = ref(null);
const plsResult = ref(null);
const streamResult = ref(null);
const audioResult = ref(null);
const metadataResult = ref(null);
const audioTestElement = ref(false);
const testAudio = ref(null);

function toggleExpanded() {
  expanded.value = !expanded.value;
}

async function testChannelsAPI() {
  loading.value = true;
  channelsResult.value = null;

  try {
    const response = await fetch('https://api.somafm.com/channels.json');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();

    channelsResult.value = {
      status: 'success',
      count: data.channels.length,
      message: `Successfully fetched ${data.channels.length} channels`
    };
  } catch (error) {
    channelsResult.value = {
      status: 'error',
      message: error.message
    };
  } finally {
    loading.value = false;
  }
}

async function testPLS() {
  loading.value = true;
  plsResult.value = null;

  try {
    // Try ice6 first - may have different GPC handling
    const url = await fetchPLS(`https://somafm.com/${selectedTestChannel.value}.pls`, 'ice6');

    if (url) {
      plsResult.value = {
        status: 'success',
        url: url,
        message: `Successfully parsed PLS (using ice6 server)`
      };
    } else {
      plsResult.value = {
        status: 'error',
        message: 'Failed to parse PLS file'
      };
    }
  } catch (error) {
    plsResult.value = {
      status: 'error',
      message: error.message
    };
  } finally {
    loading.value = false;
  }
}

async function testStreamConnection() {
  if (!plsResult.value?.url) return;

  loading.value = true;
  streamResult.value = null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(plsResult.value.url, {
      method: 'HEAD',
      signal: controller.signal,
      mode: 'no-cors' // Try no-cors mode
    });

    clearTimeout(timeout);

    streamResult.value = {
      status: 'success',
      message: `Stream responded with status: ${response.status || 'opaque (no-cors)'}`
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      streamResult.value = {
        status: 'warning',
        message: 'Request timed out (5s) - stream may be slow or blocked'
      };
    } else {
      streamResult.value = {
        status: 'error',
        message: error.message
      };
    }
  } finally {
    loading.value = false;
  }
}

async function testAudioElement() {
  if (!plsResult.value?.url) return;

  loading.value = true;
  audioResult.value = null;
  audioTestElement.value = true;

  // Wait for next tick to ensure audio element is rendered
  await new Promise(resolve => setTimeout(resolve, 100));

  try {
    const audio = testAudio.value;
    if (!audio) {
      throw new Error('Audio element not found');
    }

    audio.src = plsResult.value.url;

    // Set up event listeners
    const loadPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Load timeout (10s)')), 10000);

      audio.addEventListener('loadeddata', () => {
        clearTimeout(timeout);
        resolve('Audio loaded successfully');
      }, { once: true });

      audio.addEventListener('error', (e) => {
        clearTimeout(timeout);
        reject(new Error(`Audio error: ${audio.error?.message || 'Unknown error'}`));
      }, { once: true });

      audio.load();
    });

    const message = await loadPromise;

    audioResult.value = {
      status: 'success',
      message: message
    };
  } catch (error) {
    audioResult.value = {
      status: 'error',
      message: error.message
    };
  } finally {
    loading.value = false;
  }
}

async function testMetadata() {
  loading.value = true;
  metadataResult.value = null;

  try {
    const response = await fetch(`https://somafm.com/songs/${selectedTestChannel.value}.json`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();

    if (data.songs && data.songs.length > 0) {
      metadataResult.value = {
        status: 'success',
        song: {
          title: data.songs[0].title || 'No title',
          artist: data.songs[0].artist || 'No artist'
        }
      };
    } else {
      metadataResult.value = {
        status: 'warning',
        message: 'No songs in metadata response'
      };
    }
  } catch (error) {
    metadataResult.value = {
      status: 'error',
      message: error.message
    };
  } finally {
    loading.value = false;
  }
}

async function runAllTests() {
  await testChannelsAPI();
  await new Promise(resolve => setTimeout(resolve, 500));
  await testPLS();
  await new Promise(resolve => setTimeout(resolve, 500));
  await testStreamConnection();
  await new Promise(resolve => setTimeout(resolve, 500));
  await testMetadata();
  await new Promise(resolve => setTimeout(resolve, 500));
  await testAudioElement();
}
</script>

<style scoped>
.diagnostics {
  position: fixed;
  bottom: 20px;
  left: 20px;
  background: rgba(0, 0, 0, 0.95);
  border: 2px solid #66d9ef;
  border-radius: 8px;
  padding: 15px;
  color: #fff;
  font-family: monospace;
  font-size: 12px;
  max-width: 500px;
  max-height: 70vh;
  overflow-y: auto;
  z-index: 9999;
}

.diagnostics-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.diagnostics-header h3 {
  margin: 0;
  font-size: 14px;
  color: #66d9ef;
}

.diagnostics-header button {
  background: none;
  border: 1px solid #66d9ef;
  color: #66d9ef;
  cursor: pointer;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 16px;
}

.diagnostics-content {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.section {
  border-top: 1px solid rgba(255, 255, 255, 0.2);
  padding-top: 10px;
}

.section h4 {
  margin: 0 0 8px 0;
  font-size: 13px;
  color: #a6e22e;
}

button {
  background: #66d9ef;
  color: #000;
  border: none;
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  font-weight: bold;
  margin-right: 5px;
  margin-bottom: 5px;
}

button:hover:not(:disabled) {
  background: #7ee9ff;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

button.run-all {
  width: 100%;
  background: #a6e22e;
  margin-top: 10px;
}

select {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.3);
  padding: 4px 8px;
  border-radius: 4px;
  margin-right: 5px;
  margin-bottom: 5px;
}

.result {
  margin-top: 8px;
  padding: 8px;
  border-radius: 4px;
  font-size: 11px;
  line-height: 1.4;
}

.result.success {
  background: rgba(166, 226, 46, 0.2);
  border: 1px solid #a6e22e;
}

.result.error {
  background: rgba(255, 107, 107, 0.2);
  border: 1px solid #ff6b6b;
}

.result.warning {
  background: rgba(255, 184, 0, 0.2);
  border: 1px solid #ffb800;
}

.result code {
  background: rgba(0, 0, 0, 0.3);
  padding: 2px 4px;
  border-radius: 2px;
  font-size: 10px;
  word-break: break-all;
}

.audio-controls {
  margin-top: 8px;
}

.audio-controls audio {
  width: 100%;
  height: 30px;
}
</style>
