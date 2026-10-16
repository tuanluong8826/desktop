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

// In-memory map of in-progress track streams for deduplication and instant streaming
// In-memory map of in-progress track streams for deduplication and instant streaming
const activeDownloads = new Map();

function getCachedFilePath(id) {
  const m4a = path.join(CACHE_DIR, `${id}.m4a`);
  if (fs.existsSync(m4a)) {
    try {
      if (fs.statSync(m4a).size > 10000) return { path: m4a, mime: "audio/mp4", ext: "m4a" };
    } catch {}
  }
  const webm = path.join(CACHE_DIR, `${id}.webm`);
  if (fs.existsSync(webm)) {
    try {
      if (fs.statSync(webm).size > 10000) return { path: webm, mime: "audio/webm", ext: "webm" };
    } catch {}
  }
  return null;
}

function ensureTrackDownload(id, metadata) {
  const cached = getCachedFilePath(id);
  if (cached) return null;
  if (activeDownloads.has(id)) {
    return activeDownloads.get(id);
  }

  const isCleanId = /^[a-zA-Z0-9_-]{11}$/.test(id);
  let target = `https://www.youtube.com/watch?v=${id}`;
  if (!isCleanId && metadata) {
    const q = (metadata.artist && metadata.title ? `${metadata.artist} ${metadata.title}` : metadata.title || id).trim();
    target = `ytsearch1:${q}`;
  }

  const tempFile = path.join(CACHE_DIR, `${id}.tmp`);
  const finalFile = path.join(CACHE_DIR, `${id}.m4a`);
  const fileWriteStream = fs.createWriteStream(tempFile);
  const listeners = new Set();
  const chunks = [];

  const proc = spawn("yt-dlp", [
    "--no-playlist",
    "--no-warnings",
    "--no-check-certificates",
    "-f", "140/ba/bestaudio",
    "--buffer-size", "16K",
    "-o", "-",
    target
  ]);

  const task = {
    proc,
    tempFile,
    finalFile,
    chunks,
    listeners,
    mimeType: "audio/mp4",
    done: false,
    addListener(res) {
      res.setHeader("Content-Type", this.mimeType);
      res.setHeader("Accept-Ranges", "bytes");
      for (const chunk of chunks) {
        if (!res.writableEnded) res.write(chunk);
      }
      if (this.done) {
        if (!res.writableEnded) res.end();
      } else {
        listeners.add(res);
        res.on("close", () => {
          listeners.delete(res);
        });
      }
    }
  };

  proc.stdout.on("data", (chunk) => {
    chunks.push(chunk);
    fileWriteStream.write(chunk);
    for (const res of listeners) {
      if (!res.writableEnded) {
        try { res.write(chunk); } catch {}
      }
    }
  });

  proc.stdout.on("end", () => {
    task.done = true;
    fileWriteStream.end();
    for (const res of listeners) {
      if (!res.writableEnded) {
        try { res.end(); } catch {}
      }
    }
    listeners.clear();
    activeDownloads.delete(id);
  });

  fileWriteStream.on("finish", () => {
    try {
      if (fs.existsSync(tempFile) && fs.statSync(tempFile).size > 10000) {
        fs.renameSync(tempFile, finalFile);
        console.log(`[CDN Cache] Successfully stored track on disk: ${id} (${fs.statSync(finalFile).size} bytes)`);
      }
    } catch (e) {
      console.error("Cache rename error:", e);
    }
  });

  proc.on("error", (err) => {
    console.error("yt-dlp error:", err);
    activeDownloads.delete(id);
    for (const res of listeners) {
      if (!res.headersSent) res.status(500).json({ error: "Stream error" });
      else if (!res.writableEnded) res.end();
    }
    try { fs.unlinkSync(tempFile); } catch {}
  });

  activeDownloads.set(id, task);
  return task;
}

// 6. Playback Session creation (with stream pre-warming into CDN disk)
app.all(["/v1/tracks/:id/playback", "/v1/playback/:id"], (req, res) => {
  const id = req.params.id;
  const metadata = req.body || {};
  // Pre-warm the stream in background as soon as session is created!
  try {
    ensureTrackDownload(id, metadata);
  } catch {}

  res.json({
    sessionId: `ses_${id}_${Date.now()}`,
    playbackId: `pb_${id}`,
    trackId: id,
    transport: "proxy",
    streamUrl: `/v1/playback/${id}/media`,
    codec: "aac",
    bitrate: 160000,
    mimeType: "audio/mp4",
    expiresAt: new Date(Date.now() + 86400000).toISOString()
  });
});

// 7. Audio Media Stream (Direct audio streaming with disk cache)
app.get(["/v1/playback/:id/media", "/v1/tracks/:id/playback/media"], (req, res) => {
  const id = req.params.id;
  const cached = getCachedFilePath(id);

  // If already cached on disk, serve directly with Range support (Instant CDN < 20ms)
  if (cached) {
    try {
      const stat = fs.statSync(cached.path);
      const range = req.headers.range;
      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
        const chunksize = end - start + 1;
        const fileStream = fs.createReadStream(cached.path, { start, end });
        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunksize,
          "Content-Type": cached.mime,
        });
        return fileStream.pipe(res);
      } else {
        res.writeHead(200, {
          "Content-Length": stat.size,
          "Accept-Ranges": "bytes",
          "Content-Type": cached.mime,
        });
        return fs.createReadStream(cached.path).pipe(res);
      }
    } catch (e) {
      console.error("Error reading cache:", e);
    }
  }

  // Stream via active download task and simultaneously write to disk
  const task = ensureTrackDownload(id);
  if (task) {
    task.addListener(res);
  } else {
    const cachedAgain = getCachedFilePath(id);
    if (cachedAgain) {
      return fs.createReadStream(cachedAgain.path).pipe(res);
    }
    res.status(500).json({ error: "Download initialization failed" });
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
app.all("/v1/me/playlists", (req, res) => res.json({ items: [], total: 0 }));
app.all(["/v1/me/library/*", "/v1/me/library"], (req, res) => res.json({ items: [], total: 0 }));
app.all("/v1/me/history", (req, res) => res.json({ items: [], total: 0 }));
app.all("/v1/me/recommendations/daily-mixes", (req, res) => res.json({ items: [] }));
app.all("/v1/me/recommendations/wave", (req, res) => res.json({ tracks: [] }));
app.all("/v1/me/recommendations/taste", (req, res) => res.json({ topGenres: [], topArtists: [] }));
app.all("/v1/me/playback/events", (req, res) => res.json({ ok: true }));
app.all("/v1/me/*", (req, res) => res.json({ items: [], total: 0, ok: true }));
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
