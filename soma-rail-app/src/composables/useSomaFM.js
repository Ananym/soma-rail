import { ref, computed } from 'vue';
import { fetchPLS } from '../utils/plsParser';
import { CONFIG } from '../config';

export function useSomaFM() {
  const channels = ref([]);
  const currentChannelId = ref(null);
  const currentSong = ref({ title: '', artist: '' });
  const streamUrl = ref(null);
  const isLoading = ref(false);
  const error = ref(null);

  let metadataInterval = null;

  const currentChannel = computed(() => {
    return channels.value.find(ch => ch.id === currentChannelId.value) || null;
  });

  /**
   * Fetch all available Soma FM channels
   */
  async function fetchChannels() {
    isLoading.value = true;
    error.value = null;
    try {
      const response = await fetch('https://api.somafm.com/channels.json');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      channels.value = data.channels.map(ch => ({
        id: ch.id,
        title: ch.title,
        description: ch.description,
        image: ch.image_xlarge || ch.image,
        genre: ch.genre,
        listeners: ch.listeners,
        playlists: ch.playlists
      }));
      return channels.value;
    } catch (err) {
      error.value = `Failed to fetch channels: ${err.message}`;
      console.error('Error fetching channels:', err);
      return [];
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Set the current channel and load its stream
   */
  async function setChannel(channelId) {
    currentChannelId.value = channelId;

    // Stop existing metadata polling
    if (metadataInterval) {
      clearInterval(metadataInterval);
      metadataInterval = null;
    }

    // Find the channel's PLS URL
    const channel = currentChannel.value;
    if (!channel) {
      error.value = 'Channel not found';
      return null;
    }

    // Try AAC first - different format may have different GPC server handling
    const playlist = channel.playlists.find(p => p.format === 'aac' && p.quality === 'highest')
                  || channel.playlists.find(p => p.format === 'aac' && p.quality === 'high')
                  || channel.playlists.find(p => p.format === 'aac')
                  || channel.playlists.find(p => p.format === 'mp3' && p.quality === 'low')
                  || channel.playlists.find(p => p.format === 'mp3')
                  || channel.playlists[0];

    if (!playlist) {
      error.value = 'No playlist available for channel';
      return null;
    }

    // Get the direct stream URL from PLS
    try {
      const url = await fetchPLS(playlist.url);

      if (url) {
        streamUrl.value = url;
        console.log('[SOMA FM] Stream URL:', url);
      } else {
        error.value = 'Failed to parse stream URL';
        return null;
      }

      // Start fetching metadata
      await fetchMetadata();
      startMetadataPolling();

      return streamUrl.value;
    } catch (err) {
      error.value = `Failed to load stream: ${err.message}`;
      console.error('Error loading stream:', err);
      return null;
    }
  }

  /**
   * Fetch current song metadata
   */
  async function fetchMetadata() {
    if (!currentChannelId.value) return;

    try {
      const response = await fetch(`https://somafm.com/songs/${currentChannelId.value}.json`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      if (data.songs && data.songs.length > 0) {
        const song = data.songs[0];
        currentSong.value = {
          title: song.title || '',
          artist: song.artist || '',
          album: song.album || ''
        };
      }
    } catch (err) {
      console.error('Error fetching metadata:', err);
      // Don't update error state, just log it - metadata is non-critical
    }
  }

  /**
   * Start polling for song metadata updates
   */
  function startMetadataPolling() {
    metadataInterval = setInterval(() => {
      fetchMetadata();
    }, CONFIG.METADATA_POLL_INTERVAL);
  }

  /**
   * Stop metadata polling
   */
  function stopMetadataPolling() {
    if (metadataInterval) {
      clearInterval(metadataInterval);
      metadataInterval = null;
    }
  }

  return {
    channels,
    currentChannel,
    currentChannelId,
    currentSong,
    streamUrl,
    isLoading,
    error,
    fetchChannels,
    setChannel,
    fetchMetadata,
    stopMetadataPolling
  };
}
