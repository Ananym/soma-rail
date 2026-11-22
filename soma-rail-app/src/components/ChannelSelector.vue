<template>
  <div ref="rootEl" class="channel-selector" :class="{ 'fade-out': shouldFade && !modal, touch, modal }" :role="modal ? 'dialog' : null" :aria-modal="modal ? 'true' : null" aria-label="Select channel">
    <div class="selector-header">
      <button v-if="modal" type="button" class="close" aria-label="Close channels" @click="$emit('close')">Close</button>
      <h2>Select Channel</h2>
      <div class="support-message">
        <p>
          Enjoying Soma FM?
          <a href="https://somafm.com/support/" target="_blank" rel="noopener">
            Please consider supporting them
          </a>
        </p>
      </div>
    </div>

    <div v-if="isLoading" class="loading">Loading channels...</div>

    <div v-else-if="error" class="error">{{ error }}</div>

    <div v-else class="channels-grid">
      <button
        v-for="channel in channels"
        :key="channel.id"
        class="channel-item"
        :class="{ active: channel.id === currentChannelId }"
        @click="selectChannel(channel.id)"
      >
        <img
          v-if="channel.image"
          :src="channel.image"
          :alt="channel.title"
          class="channel-image"
        />
        <div class="channel-info">
          <h3>{{ channel.title }}</h3>
          <p>{{ channel.genre }}</p>
        </div>
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { CONFIG } from '../config';

const props = defineProps({
  channels: {
    type: Array,
    default: () => []
  },
  currentChannelId: {
    type: String,
    default: null
  },
  isLoading: {
    type: Boolean,
    default: false
  },
  error: {
    type: String,
    default: null
  },
  lastMouseMoveTime: {
    type: Number,
    default: Date.now()
  },
  touch: {
    type: Boolean,
    default: false
  },
  // On a touch screen the channels open as a dialog of their own (see App.vue): it does not fade
  // with the rest of the overlay, and has a Close button.
  modal: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['select-channel', 'close']);

// As a dialog it opens at the channel that is playing, not at the top of a long list.
const rootEl = ref(null);
onMounted(() => {
  if (!props.modal || !rootEl.value) return;
  const active = rootEl.value.querySelector('.channel-item.active');
  if (active && active.scrollIntoView) active.scrollIntoView({ block: 'center' });
});

const currentTime = ref(Date.now());
let intervalId = null;

// Update current time every second to check fade state
onMounted(() => {
  intervalId = setInterval(() => {
    currentTime.value = Date.now();
  }, 100);
});

onUnmounted(() => {
  if (intervalId) {
    clearInterval(intervalId);
  }
});

const shouldFade = computed(() => {
  const timeSinceLastMove = currentTime.value - props.lastMouseMoveTime;
  return timeSinceLastMove > CONFIG.UI_FADE_DELAY;
});

function selectChannel(channelId) {
  emit('select-channel', channelId);
}
</script>

<style scoped>
.channel-selector {
  position: fixed;
  top: 20px;
  left: 20px;
  max-width: 500px;
  max-height: 80vh;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(10px);
  border-radius: 12px;
  padding: 20px;
  color: #fff;
  overflow-y: auto;
  z-index: 100;
  transition: opacity 0.5s ease;
  opacity: 1;
}

.channel-selector.fade-out {
  opacity: 0;
  pointer-events: none;
}

.selector-header {
  margin-bottom: 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
  padding-bottom: 15px;
}

.selector-header h2 {
  margin: 0 0 10px 0;
  font-size: 24px;
  font-weight: 300;
}

.support-message {
  margin-top: 10px;
  padding: 10px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  font-size: 14px;
}

.support-message p {
  margin: 0;
}

.support-message a {
  color: #66d9ef;
  text-decoration: none;
  font-weight: 500;
}

.support-message a:hover {
  text-decoration: underline;
}

.loading,
.error {
  text-align: center;
  padding: 20px;
  font-size: 16px;
}

.error {
  color: #ff6b6b;
}

.channels-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}

.channel-item {
  display: flex;
  align-items: center;
  gap: 15px;
  background: rgba(255, 255, 255, 0.05);
  border: 2px solid transparent;
  border-radius: 8px;
  padding: 10px;
  cursor: pointer;
  transition: all 0.3s ease;
  color: #fff;
  text-align: left;
}

/* only where a pointer can hover: on a touch screen the last thing tapped would stay lit */
@media (hover: hover) {
  .channel-item:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.3);
  }
}

.channel-item.active {
  background: rgba(102, 217, 239, 0.2);
  border-color: #66d9ef;
}

.channel-image {
  width: 60px;
  height: 60px;
  object-fit: cover;
  border-radius: 6px;
  flex-shrink: 0;
}

.channel-info h3 {
  margin: 0 0 5px 0;
  font-size: 16px;
  font-weight: 500;
}

.channel-info p {
  margin: 0;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.7);
}

/* touch: tighter, so more channels fit between the other two panels */
.channel-selector.touch { padding: 12px; -webkit-overflow-scrolling: touch; }
.channel-selector.touch .selector-header { margin-bottom: 10px; padding-bottom: 10px; }
.channel-selector.touch .selector-header h2 { font-size: 18px; margin-bottom: 6px; }
.channel-selector.touch .support-message { margin-top: 6px; padding: 8px; font-size: 13px; }
.channel-selector.touch .channels-grid { gap: 6px; }
.channel-selector.touch .channel-item { padding: 8px; gap: 12px; }
.channel-selector.touch .channel-image { width: 44px; height: 44px; }
.channel-selector.touch .channel-info h3 { font-size: 15px; margin-bottom: 2px; }

/* as a dialog (touch screens): placed and sized by App.vue's .channel-modal */
.channel-selector.modal { position: static; width: 100%; max-width: 560px; max-height: 100%; overscroll-behavior: contain; }
.channel-selector.modal .selector-header { position: relative; }
.close {
  position: absolute;
  top: -2px;
  right: 0;
  min-height: 36px;
  padding: 6px 14px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 6px;
  color: #fff;
  font: inherit;
  font-size: 14px;
}
.close:focus-visible { outline: 2px solid #66d9ef; outline-offset: 2px; }

/* Scrollbar styling */
.channel-selector::-webkit-scrollbar {
  width: 8px;
}

.channel-selector::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 4px;
}

.channel-selector::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 4px;
}

.channel-selector::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.3);
}
</style>
