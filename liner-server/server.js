import express from "express";
import cors from "cors";
import { Innertube, UniversalCache } from "youtubei.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["*"],
  exposedHeaders: ["Date", "date", "x-liner-server-time", "x-request-id", "content-range", "accept-ranges", "etag"]
}));

app.use(express.json());

// Attach server time and request-id to every response
app.use((req, res, next) => {
  res.setHeader("x-liner-server-time", Math.floor(Date.now() / 1000).toString());
  res.setHeader("x-request-id", req.headers["x-request-id"] || `req_${Date.now()}`);
  next();
});

let yt = null;
async function getYt() {
  if (!yt) {
    yt = await Innertube.create({
      cache: new UniversalCache(false),
      generate_session_locally: true
    });
  }
  return yt;
}

// 1. Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", server: "liner-selfhosted-oracle", version: "1.0.0" });
});

// 2. Explore / Popular (Trending music)
app.get("/v1/explore/popular", async (req, res) => {
  try {
    const youtube = await getYt();
    // Default to trending music charts
    const charts = await youtube.music.getExplore();
    const items = [];

    // Parse trending tracks
    if (charts && charts.top_songs) {
      for (const item of charts.top_songs.contents || []) {
        items.push({
          id: item.id || item.video_id,
          title: item.title,
          artists: (item.artists || []).map(a => ({ id: a.id || "unknown", name: a.name })),
          durationMs: (item.duration?.seconds || 180) * 1000,
          cover: {
            url: item.thumbnails?.[0]?.url || "",
            width: 500,
            height: 500
          }
        });
      }
    }

    res.json({ items: items.length > 0 ? items : getFallbackPopular() });
  } catch (err) {
    console.error("Explore popular error:", err);
    res.json({ items: getFallbackPopular() });
  }
});

// 3. Search
app.get("/v1/search", async (req, res) => {
  const query = req.query.q || req.query.query;
  if (!query) return res.json({ items: [] });

  try {
    const youtube = await getYt();
    const searchResult = await youtube.music.search(query, { type: "song" });
    const items = [];

    for (const song of searchResult.songs?.contents || searchResult.contents || []) {
      const id = song.id || song.video_id;
      if (!id) continue;
      items.push({
        type: "track",
        id,
        title: song.title || "Unknown Title",
        artists: (song.artists || []).map(a => ({ id: a.id || "artist", name: a.name })),
        album: song.album ? { id: song.album.id || "album", title: song.album.name } : undefined,
        durationMs: (song.duration?.seconds || 180) * 1000,
        cover: {
          url: song.thumbnails?.[0]?.url || "",
          width: 500,
          height: 500
        }
      });
    }

    res.json({ items });
  } catch (err) {
    console.error("Search error:", err);
    res.json({ items: [] });
  }
});

// 4. Track Details
app.get("/v1/tracks/:id", async (req, res) => {
  const id = req.params.id;
  try {
    const youtube = await getYt();
    const info = await youtube.music.getInfo(id);
    const basic = info.basic_info;

    res.json({
      id,
      title: basic.title || "Track",
      artists: [{ id: basic.channel_id || "artist", name: basic.author || "Artist" }],
      durationMs: (basic.duration || 180) * 1000,
      cover: {
        url: basic.thumbnail?.[0]?.url || "",
        width: 500,
        height: 500
      }
    });
  } catch (err) {
    console.error("Track details error:", err);
    res.status(404).json({ error: "Track not found" });
  }
});

// 5. Radio (Similar Tracks / Up Next)
app.all("/v1/tracks/:id/radio", async (req, res) => {
  const id = req.params.id;
  try {
    const youtube = await getYt();
    const upNext = await youtube.music.getUpNext(id);
    const items = [];

    for (const track of upNext.contents || []) {
      const trackId = track.id || track.video_id;
      if (!trackId || trackId === id) continue;
      items.push({
        type: "track",
        id: trackId,
        title: track.title,
        artists: (track.artists || []).map(a => ({ id: a.id || "artist", name: a.name })),
        durationMs: (track.duration?.seconds || 180) * 1000,
        cover: {
          url: track.thumbnails?.[0]?.url || "",
          width: 500,
          height: 500
        }
      });
    }

    res.json({ items });
  } catch (err) {
    console.error("Radio error:", err);
    res.json({ items: [] });
  }
});

// 6. Playback Session
app.all("/v1/playback/:id", (req, res) => {
  const id = req.params.id;
  res.json({
    sessionId: `ses_${id}_${Date.now()}`,
    trackId: id,
    streamUrl: `/v1/playback/${id}/media`,
    codec: "opus",
    bitrate: 160000,
    mimeType: "audio/webm",
    expiresAt: new Date(Date.now() + 86400000).toISOString()
  });
});

// 7. Audio Media Stream (Direct audio streaming from YouTube Music)
app.get("/v1/playback/:id/media", async (req, res) => {
  const id = req.params.id;
  try {
    const youtube = await getYt();
    const downloadStream = await youtube.download(id, {
      type: "audio",
      quality: "best",
      format: "any"
    });

    res.setHeader("Content-Type", "audio/webm");
    res.setHeader("Accept-Ranges", "bytes");

    // Convert Web ReadableStream to Node response stream
    const reader = downloadStream.getReader();
    async function pump() {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          res.end();
          break;
        }
        res.write(Buffer.from(value));
      }
    }
    pump().catch(err => {
      console.error("Stream pump error:", err);
      res.end();
    });
  } catch (err) {
    console.error("Playback media error:", err);
    res.status(500).json({ error: "Failed to stream audio" });
  }
});

// 8. Synced Lyrics (via LRCLIB with fallback)
app.get("/v1/tracks/:id/lyrics", async (req, res) => {
  const id = req.params.id;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    const youtube = await getYt();
    const info = await youtube.music.getInfo(id);
    const title = info.basic_info.title || "";
    const artist = info.basic_info.author || "";

    // Query LRCLIB for synced syllable/line lyrics
    const lrclibUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(artist)}`;
    const lrcRes = await fetch(lrclibUrl, { headers: { "User-Agent": "Liner-SelfHosted/1.0" } });
    
    if (lrcRes.ok) {
      const data = await lrcRes.json();
      if (data.syncedLyrics) {
        // Parse [mm:ss.xx] line
        const lines = data.syncedLyrics.split("\n");
        const events = [];
        for (const line of lines) {
          const match = line.match(/\[(\d+):(\d+\.\d+)\]\s*(.*)/);
          if (match) {
            const min = parseInt(match[1], 10);
            const sec = parseFloat(match[2]);
            const startMs = Math.round((min * 60 + sec) * 1000);
            const text = match[3];
            events.push({ text, start_ms: startMs });
          }
        }
        for (let i = 0; i < events.length; i++) {
          const cur = events[i];
          const next = events[i + 1];
          cur.end_ms = next ? next.start_ms : cur.start_ms + 4000;
          res.write(`data: ${JSON.stringify(cur)}\n\n`);
        }
      }
    }
    res.write("event: done\ndata: {}\n\n");
    res.end();
  } catch (err) {
    res.write("event: done\ndata: {}\n\n");
    res.end();
  }
});

// 9. User profile & Library mocks
app.get("/v1/me", (req, res) => {
  res.json({ id: "self_user", username: "selfhost", displayName: "Oracle Cloud User" });
});
app.get("/v1/me/playlists", (req, res) => res.json({ items: [] }));
app.get("/v1/me/library/tracks", (req, res) => res.json({ items: [] }));
app.get("/v1/me/history", (req, res) => res.json({ items: [] }));
app.get("/v1/me/recommendations/daily-mixes", (req, res) => res.json({ items: [] }));
app.post("/v1/me/playback/events", (req, res) => res.json({ ok: true }));

function getFallbackPopular() {
  return [
    {
      id: "ngpLgc54vBc",
      title: "EM ĐAU",
      artists: [{ id: "plk", name: "Phùng Khánh Linh" }],
      durationMs: 230000,
      cover: { url: "https://i.ytimg.com/vi/ngpLgc54vBc/hqdefault.jpg", width: 500, height: 500 }
    }
  ];
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Liner Self-hosted Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
