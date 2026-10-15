import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { Innertube, UniversalCache } from "youtubei.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, "cache");
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

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
app.get(["/health", "/v1/health"], (req, res) => {
  res.json({ status: "ok", server: "liner-selfhosted-oracle", version: "1.0.0" });
});

function formatTrack(item) {
  const id = item.id || item.video_id;
  if (!id) return null;
  const title = typeof item.title === "string" ? item.title : (item.title?.text || item.title?.runs?.[0]?.text || "Track");
  const thumbUrl = item.thumbnails?.[0]?.url || item.thumbnail?.contents?.[0]?.url || item.thumbnail?.[0]?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  const artists = (item.artists || []).map(a => ({
    id: a.id || "artist",
    name: typeof a.name === "string" ? a.name : (a.text || a.name?.text || "Artist")
  }));
  if (artists.length === 0 && (item.author || item.channel_id)) {
    artists.push({ id: item.channel_id || "artist", name: typeof item.author === "string" ? item.author : (item.author?.name || "Artist") });
  }
  return {
    type: "track",
    id,
    title,
    artists: artists.length > 0 ? artists : [{ id: "artist", name: "Artist" }],
    album: item.album ? { id: item.album.id || "album", title: item.album.name } : undefined,
    durationMs: (item.duration?.seconds || (typeof item.duration === "number" ? item.duration : 180)) * 1000,
    cover: {
      url: thumbUrl,
      width: 500,
      height: 500
    }
  };
}

// 2. Explore / Popular (Trending music)
app.get("/v1/explore/popular", async (req, res) => {
  try {
    const youtube = await getYt();
    const charts = await youtube.music.getExplore();
    const items = [];

    if (charts && charts.top_songs) {
      for (const item of charts.top_songs.contents || []) {
        const formatted = formatTrack(item);
        if (formatted) items.push(formatted);
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
      const formatted = formatTrack(song);
      if (formatted) items.push(formatted);
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
    const searchRes = await youtube.music.search(id);
    const first = (searchRes.songs?.contents || searchRes.contents || [])[0];
    if (first) {
      const formatted = formatTrack(first);
      if (formatted) {
        return res.json(formatted);
      }
    }
  } catch (err) {
    console.error("Track details error:", err);
  }

  res.json({
    type: "track",
    id,
    title: "Track",
    artists: [{ id: "artist", name: "Artist" }],
    durationMs: 180000,
    cover: { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, width: 500, height: 500 }
  });
});

// 5. Radio (Similar Tracks / Up Next)
app.all(["/v1/tracks/:id/radio", "/v1/radio/:id"], async (req, res) => {
  const id = req.params.id;
  try {
    const youtube = await getYt();
    const upNext = await youtube.music.getUpNext(id);
    const items = [];

    for (const track of upNext.contents || []) {
      const formatted = formatTrack(track);
      if (formatted && formatted.id !== id) {
        items.push(formatted);
      }
    }

    res.json({ items });
  } catch (err) {
    console.error("Radio error:", err);
    res.json({ items: [] });
  }
});

// 6. Playback Session creation
app.all(["/v1/tracks/:id/playback", "/v1/playback/:id"], (req, res) => {
  const id = req.params.id;
  res.json({
    sessionId: `ses_${id}_${Date.now()}`,
    playbackId: `pb_${id}`,
    trackId: id,
    transport: "proxy",
    streamUrl: `/v1/playback/${id}/media`,
    codec: "opus",
    bitrate: 160000,
    mimeType: "audio/webm",
    expiresAt: new Date(Date.now() + 86400000).toISOString()
  });
});

// 7. Audio Media Stream (Direct audio streaming with disk cache)
app.get(["/v1/playback/:id/media", "/v1/tracks/:id/playback/media"], (req, res) => {
  const id = req.params.id;
  const cachedFile = path.join(CACHE_DIR, `${id}.webm`);

  // If already cached on disk, serve directly with Range support
  if (fs.existsSync(cachedFile)) {
    try {
      const stat = fs.statSync(cachedFile);
      if (stat.size > 10000) {
        const range = req.headers.range;
        if (range) {
          const parts = range.replace(/bytes=/, "").split("-");
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
          const chunksize = end - start + 1;
          const fileStream = fs.createReadStream(cachedFile, { start, end });
          res.writeHead(206, {
            "Content-Range": `bytes ${start}-${end}/${stat.size}`,
            "Accept-Ranges": "bytes",
            "Content-Length": chunksize,
            "Content-Type": "audio/webm",
          });
          return fileStream.pipe(res);
        } else {
          res.writeHead(200, {
            "Content-Length": stat.size,
            "Accept-Ranges": "bytes",
            "Content-Type": "audio/webm",
          });
          return fs.createReadStream(cachedFile).pipe(res);
        }
      }
    } catch (e) {
      console.error("Error reading cache:", e);
    }
  }

  // Not cached yet: Stream via yt-dlp through Tor proxy
  res.setHeader("Content-Type", "audio/webm");
  res.setHeader("Accept-Ranges", "bytes");

  const tempFile = path.join(CACHE_DIR, `${id}.tmp`);
  const fileWriteStream = fs.createWriteStream(tempFile);

  const proc = spawn("yt-dlp", [
    "--proxy", "socks5://127.0.0.1:9050",
    "-f", "ba/b",
    "-o", "-",
    `https://www.youtube.com/watch?v=${id}`
  ]);

  let isClientClosed = false;
  req.on("close", () => {
    isClientClosed = true;
    if (!res.writableEnded) {
      try { res.end(); } catch {}
    }
  });

  proc.stdout.on("data", (chunk) => {
    if (!isClientClosed) {
      res.write(chunk);
    }
    fileWriteStream.write(chunk);
  });

  proc.stdout.on("end", () => {
    fileWriteStream.end();
    if (!isClientClosed && !res.writableEnded) {
      res.end();
    }
  });

  fileWriteStream.on("finish", () => {
    try {
      if (fs.existsSync(tempFile) && fs.statSync(tempFile).size > 10000) {
        fs.renameSync(tempFile, cachedFile);
        console.log(`[Cache] Successfully cached track: ${id}`);
      }
    } catch (e) {
      console.error("Failed to rename temp file to cache:", e);
    }
  });

  proc.on("error", (err) => {
    console.error("yt-dlp spawn error:", err);
    if (!res.headersSent) res.status(500).json({ error: "Stream error" });
    try { fs.unlinkSync(tempFile); } catch {}
  });
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

    const lrclibUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(artist)}`;
    const lrcRes = await fetch(lrclibUrl, { headers: { "User-Agent": "Liner-SelfHosted/1.0" } });
    
    if (lrcRes.ok) {
      const data = await lrcRes.json();
      if (data.syncedLyrics) {
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

// 9. Artist Details
app.get("/v1/artists/:id", async (req, res) => {
  const id = req.params.id;
  try {
    const youtube = await getYt();
    const artist = await youtube.music.getArtist(id);
    const name = artist.header?.title?.text || "Artist";
    const tracks = [];
    if (artist.sections) {
      for (const section of artist.sections) {
        if (section.contents) {
          for (const item of section.contents) {
            const trackId = item.id || item.video_id;
            if (trackId) {
              tracks.push({
                type: "track",
                id: trackId,
                title: item.title?.text || item.title || "Track",
                artists: [{ id, name }],
                durationMs: (item.duration?.seconds || 180) * 1000,
                cover: { url: item.thumbnails?.[0]?.url || "", width: 500, height: 500 }
              });
            }
          }
        }
      }
    }
    res.json({
      type: "artist",
      id,
      name,
      verified: true,
      tracks: tracks.slice(0, 50),
      albums: [],
      singles: []
    });
  } catch (err) {
    res.json({
      type: "artist",
      id,
      name: "Artist",
      verified: true,
      tracks: [],
      albums: [],
      singles: []
    });
  }
});

// 10. Album Details
app.get("/v1/albums/:id", async (req, res) => {
  const id = req.params.id;
  try {
    const youtube = await getYt();
    const album = await youtube.music.getAlbum(id);
    const title = album.header?.title?.text || "Album";
    const tracks = [];
    for (const item of album.contents || []) {
      const trackId = item.id || item.video_id;
      if (trackId) {
        tracks.push({
          type: "track",
          id: trackId,
          title: item.title?.text || item.title || "Track",
          artists: (item.artists || []).map(a => ({ id: a.id || "artist", name: a.name })),
          durationMs: (item.duration?.seconds || 180) * 1000,
          cover: { url: item.thumbnails?.[0]?.url || "", width: 500, height: 500 }
        });
      }
    }
    res.json({
      type: "album",
      id,
      title,
      artists: (album.header?.author?.name ? [{ id: "artist", name: album.header.author.name }] : []),
      tracks
    });
  } catch (err) {
    res.json({
      type: "album",
      id,
      title: "Album",
      artists: [],
      tracks: []
    });
  }
});

// 11. Playlist Details
app.get(["/v1/catalog/playlists/:id", "/v1/playlists/:id"], async (req, res) => {
  const id = req.params.id;
  try {
    const youtube = await getYt();
    const pl = await youtube.music.getPlaylist(id);
    const title = pl.header?.title?.text || "Playlist";
    const tracks = [];
    for (const item of pl.contents || []) {
      const trackId = item.id || item.video_id;
      if (trackId) {
        tracks.push({
          type: "track",
          id: trackId,
          title: item.title?.text || item.title || "Track",
          artists: (item.artists || []).map(a => ({ id: a.id || "artist", name: a.name })),
          durationMs: (item.duration?.seconds || 180) * 1000,
          cover: { url: item.thumbnails?.[0]?.url || "", width: 500, height: 500 }
        });
      }
    }
    res.json({
      type: "playlist",
      id,
      title,
      tracks
    });
  } catch (err) {
    res.json({
      type: "playlist",
      id,
      title: "Playlist",
      tracks: []
    });
  }
});

// 12. User profile, Auth & Library mocks
app.all("/v1/auth/login", (req, res) => {
  res.json({
    accessToken: "self_token_" + Date.now(),
    refreshToken: "self_refresh_" + Date.now(),
    user: { id: "self_user", username: "selfhost", displayName: "Oracle Cloud User" }
  });
});
app.all("/v1/auth/register", (req, res) => {
  res.json({
    accessToken: "self_token_" + Date.now(),
    refreshToken: "self_refresh_" + Date.now(),
    user: { id: "self_user", username: "selfhost", displayName: "Oracle Cloud User" }
  });
});
app.get(["/v1/me", "/v1/users/me"], (req, res) => {
  res.json({ id: "self_user", username: "selfhost", displayName: "Oracle Cloud User" });
});
app.get("/v1/me/playlists", (req, res) => res.json({ items: [] }));
app.get("/v1/me/library/tracks", (req, res) => res.json({ items: [] }));
app.get("/v1/me/history", (req, res) => res.json({ items: [] }));
app.get("/v1/me/recommendations/daily-mixes", (req, res) => res.json({ items: [] }));
app.get("/v1/me/recommendations/wave", (req, res) => res.json({ tracks: [] }));
app.get("/v1/me/recommendations/taste", (req, res) => res.json({ topGenres: [], topArtists: [] }));
app.all("/v1/me/playback/events", (req, res) => res.json({ ok: true }));
app.get("/v1/leaderboards/*", (req, res) => res.json({ items: [], period: "monthly" }));

function getFallbackPopular() {
  return [
    {
      type: "track",
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
