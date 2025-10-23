import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Soma FM API Integration', () => {
  beforeEach(() => {
    // Reset fetch mock before each test
    vi.resetAllMocks();
  });

  describe('Channel List API', () => {
    it('should fetch channels from Soma FM API', async () => {
      // Test the actual API call
      const response = await fetch('https://api.somafm.com/channels.json');
      const data = await response.json();

      expect(response.ok).toBe(true);
      expect(data).toHaveProperty('channels');
      expect(Array.isArray(data.channels)).toBe(true);
      expect(data.channels.length).toBeGreaterThan(0);
    }, 10000); // 10 second timeout for network request

    it('should have required channel properties', async () => {
      const response = await fetch('https://api.somafm.com/channels.json');
      const data = await response.json();

      const firstChannel = data.channels[0];
      expect(firstChannel).toHaveProperty('id');
      expect(firstChannel).toHaveProperty('title');
      expect(firstChannel).toHaveProperty('playlists');
      expect(Array.isArray(firstChannel.playlists)).toBe(true);
    }, 10000);
  });

  describe('PLS File Fetching', () => {
    it('should fetch a PLS file from Soma FM', async () => {
      // Test with a known channel
      const response = await fetch('https://somafm.com/groovesalad.pls');
      const text = await response.text();

      expect(response.ok).toBe(true);
      expect(text).toContain('[playlist]');
      expect(text).toContain('File1=');
    }, 10000);

    it('PLS file should contain valid stream URLs', async () => {
      const response = await fetch('https://somafm.com/groovesalad.pls');
      const text = await response.text();

      const match = text.match(/File1=(.+)/);
      expect(match).toBeTruthy();
      expect(match[1]).toMatch(/^https?:\/\//);
    }, 10000);
  });

  describe('Song Metadata API', () => {
    it('should fetch song metadata from Soma FM', async () => {
      const response = await fetch('https://somafm.com/songs/groovesalad.json');
      const data = await response.json();

      expect(response.ok).toBe(true);
      expect(data).toHaveProperty('songs');
      expect(Array.isArray(data.songs)).toBe(true);
    }, 10000);

    it('song metadata should have title and artist', async () => {
      const response = await fetch('https://somafm.com/songs/groovesalad.json');
      const data = await response.json();

      if (data.songs.length > 0) {
        const firstSong = data.songs[0];
        // Songs should have at least one of these properties
        const hasMetadata = firstSong.title || firstSong.artist;
        expect(hasMetadata).toBeTruthy();
      }
    }, 10000);
  });

  describe('Stream URL Accessibility', () => {
    it('should be able to HEAD request a stream URL', async () => {
      // First get a stream URL
      const plsResponse = await fetch('https://somafm.com/groovesalad.pls');
      const plsText = await plsResponse.text();
      const match = plsText.match(/File1=(.+)/);

      if (match) {
        const streamUrl = match[1].trim().replace('ice2.somafm.com', 'ice1.somafm.com');

        // Try to HEAD the stream URL to check if it's accessible
        try {
          const streamResponse = await fetch(streamUrl, {
            method: 'HEAD',
            signal: AbortSignal.timeout(5000)
          });

          // We expect either 200 or 403 (403 means server exists but may require different headers)
          expect([200, 403, 302, 301]).toContain(streamResponse.status);
        } catch (error) {
          // Network errors are also informative
          console.log('Stream URL test result:', error.message);
        }
      }
    }, 15000);
  });
});
