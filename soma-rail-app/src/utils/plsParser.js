/**
 * Parse PLS playlist file to extract stream URL
 * @param {string} plsText - The PLS file content
 * @param {string} preferredServer - Preferred ice server ('ice1', 'ice3', 'ice4', or 'original')
 * @returns {string|null} - The first stream URL or null
 */
export function parsePLS(plsText, preferredServer = 'ice6') {
  try {
    // Try to find File1 first
    const match = plsText.match(/File1=(.+)/);
    if (match) {
      let url = match[1].trim();

      // Replace server if preference is set
      if (preferredServer !== 'original') {
        url = url.replace(/ice[1-6]\.somafm\.com/, `${preferredServer}.somafm.com`);
      }

      return url;
    }
    return null;
  } catch (error) {
    console.error('Error parsing PLS:', error);
    return null;
  }
}

/**
 * Fetch and parse a PLS file from a URL
 * @param {string} url - The PLS file URL
 * @param {string} preferredServer - Preferred ice server
 * @returns {Promise<string|null>} - The stream URL
 */
export async function fetchPLS(url, preferredServer = 'ice6') {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const text = await response.text();
    return parsePLS(text, preferredServer);
  } catch (error) {
    console.error('Error fetching PLS:', error);
    return null;
  }
}

/**
 * Get all possible stream URLs from PLS text (all servers)
 * @param {string} plsText - The PLS file content
 * @returns {string[]} - Array of stream URLs for different servers
 */
export function getAllStreamUrls(plsText) {
  const baseUrl = parsePLS(plsText, 'original');
  if (!baseUrl) return [];

  const servers = ['ice3', 'ice1', 'ice4', 'ice5', 'ice6'];
  return servers.map(server =>
    baseUrl.replace(/ice[1-6]\.somafm\.com/, `${server}.somafm.com`)
  );
}
