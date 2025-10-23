import express from 'express';
import cors from 'cors';

const app = express();
const PORT = 3001;

// Enable CORS for our frontend
app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true
}));

// Proxy endpoint for Soma FM streams
app.get('/stream/:streamPath', async (req, res) => {
  const streamPath = req.params.streamPath;
  const streamUrl = `https://ice6.somafm.com/${streamPath}`;

  console.log(`[PROXY] Fetching stream: ${streamUrl}`);

  try {
    const response = await fetch(streamUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
        'Accept-Encoding': 'identity',
        'Range': req.headers.range || 'bytes=0-',
        'Icy-MetaData': '1'
      }
    });

    if (!response.ok) {
      console.error(`[PROXY] Stream error: ${response.status} ${response.statusText}`);
      return res.status(response.status).send(`Stream error: ${response.statusText}`);
    }

    console.log(`[PROXY] Stream connected: ${response.status}`);

    // Forward headers
    res.set({
      'Content-Type': response.headers.get('content-type') || 'audio/mpeg',
      'Cache-Control': 'no-cache, no-store',
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': 'http://localhost:5173',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range'
    });

    // Handle range requests
    if (response.status === 206) {
      res.status(206);
      res.set('Content-Range', response.headers.get('content-range'));
    }

    // Stream the response
    const reader = response.body.getReader();
    const pump = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!res.write(value)) {
            await new Promise(resolve => res.once('drain', resolve));
          }
        }
        res.end();
      } catch (error) {
        console.error('[PROXY] Stream error:', error.message);
        res.end();
      }
    };

    pump();

  } catch (error) {
    console.error('[PROXY] Fetch error:', error.message);
    res.status(500).send(`Proxy error: ${error.message}`);
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`\n🎵 Soma Rail Proxy Server running on http://localhost:${PORT}`);
  console.log(`Frontend should use: http://localhost:${PORT}/stream/groovesalad-128-mp3\n`);
});
