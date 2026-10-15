/**
 * Native, zero-dependency Discord Rich Presence (RPC) client for Liner
 * Communicates directly with local Discord desktop client via local IPC socket.
 * Displays "Listening to [Track] by [Artist]" with live progress bar and album art (like Spotify).
 */

import net from "node:net";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

export interface DiscordSongActivity {
  title: string;
  artist: string;
  album?: string;
  coverUrl?: string;
  durationMs?: number;
  positionMs?: number;
  paused?: boolean;
}

const DEFAULT_CLIENT_ID = "1506557496276549642"; // Milo/Liner Discord App ID

export class DiscordRpcClient {
  private socket: net.Socket | null = null;
  private clientId: string;
  private isConnected = false;
  private isConnecting = false;
  private isHandshakeComplete = false;
  private enabled = true;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private currentActivity: DiscordSongActivity | null = null;

  constructor(clientId = DEFAULT_CLIENT_ID) {
    this.clientId = process.env.VITE_DISCORD_CLIENT_ID || clientId;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.clearActivity();
      this.disconnect();
    } else if (this.currentActivity) {
      this.setActivity(this.currentActivity);
    }
  }

  public isRpcEnabled(): boolean {
    return this.enabled;
  }

  private getSocketPaths(): string[] {
    const isWindows = process.platform === "win32";
    const paths: string[] = [];

    if (isWindows) {
      for (let i = 0; i < 10; i++) {
        paths.push(`\\\\?\\pipe\\discord-ipc-${i}`);
      }
      return paths;
    }

    const candidateDirs = [
      os.tmpdir(),
      process.env.XDG_RUNTIME_DIR,
      process.env.TMPDIR,
      process.env.TMP,
      process.env.TEMP,
      "/tmp",
    ].filter(Boolean) as string[];

    for (const dir of candidateDirs) {
      for (let i = 0; i < 10; i++) {
        const sock = path.join(dir, `discord-ipc-${i}`);
        paths.push(sock);
      }
    }

    return paths;
  }

  public async connect(): Promise<boolean> {
    if (this.isConnected || this.isConnecting || !this.enabled) return this.isConnected;
    this.isConnecting = true;

    const socketPaths = this.getSocketPaths();

    for (const sockPath of socketPaths) {
      if (process.platform !== "win32" && !fs.existsSync(sockPath)) {
        continue;
      }

      try {
        const ok = await this.tryConnectSocket(sockPath);
        if (ok) {
          this.isConnecting = false;
          this.isConnected = true;
          this.sendHandshake();
          return true;
        }
      } catch {
        // try next socket path
      }
    }

    this.isConnecting = false;
    this.scheduleReconnect();
    return false;
  }

  private tryConnectSocket(sockPath: string): Promise<boolean> {
    return new Promise((resolve) => {
      const sock = net.createConnection(sockPath);

      sock.once("connect", () => {
        this.socket = sock;
        this.setupSocketEvents(sock);
        resolve(true);
      });

      sock.once("error", () => {
        sock.destroy();
        resolve(false);
      });
    });
  }

  private setupSocketEvents(sock: net.Socket): void {
    sock.on("data", (data: Buffer) => {
      try {
        if (data.length >= 8) {
          const len = data.readInt32LE(4);
          const raw = data.subarray(8, 8 + len).toString("utf-8");
          const json = JSON.parse(raw);
          if (json.evt === "READY") {
            this.isHandshakeComplete = true;
            console.log("[DiscordRPC] Connected to Discord as", json.data?.user?.username);
            if (this.currentActivity) {
              this.sendActivityPayload(this.currentActivity);
            }
          }
        }
      } catch {}
    });

    sock.on("close", () => {
      this.isConnected = false;
      this.isHandshakeComplete = false;
      this.socket = null;
      if (this.enabled) {
        this.scheduleReconnect();
      }
    });

    sock.on("error", () => {
      this.isConnected = false;
      this.isHandshakeComplete = false;
      sock.destroy();
      this.socket = null;
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this.enabled) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.isConnected && this.enabled) {
        void this.connect();
      }
    }, 15000);
  }

  private sendPacket(opcode: number, payload: object): void {
    if (!this.socket || !this.isConnected) return;

    try {
      const json = JSON.stringify(payload);
      const payloadBuf = Buffer.from(json, "utf-8");
      const header = Buffer.alloc(8);
      header.writeInt32LE(opcode, 0);
      header.writeInt32LE(payloadBuf.length, 4);

      this.socket.write(Buffer.concat([header, payloadBuf]));
    } catch (err) {
      console.warn("[DiscordRPC] Write error:", err);
    }
  }

  private sendHandshake(): void {
    this.sendPacket(0, {
      v: 1,
      client_id: this.clientId,
    });
  }

  public setActivity(activity: DiscordSongActivity | null): void {
    this.currentActivity = activity;
    if (!this.enabled) return;

    if (!this.isConnected || !this.isHandshakeComplete) {
      void this.connect();
      return;
    }

    this.sendActivityPayload(activity);
  }

  private sendActivityPayload(activity: DiscordSongActivity | null): void {
    if (!activity || !activity.title) {
      this.sendPacket(1, {
        cmd: "SET_ACTIVITY",
        args: {
          pid: process.pid,
          activity: null,
        },
        nonce: Math.random().toString(36).slice(2),
      });
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const posSec = Math.floor((activity.positionMs || 0) / 1000);
    const durSec = Math.floor((activity.durationMs || 0) / 1000);

    const startTimestamp = now - posSec;
    const endTimestamp = durSec > 0 ? startTimestamp + durSec : undefined;

    const payloadActivity: Record<string, unknown> = {
      type: 2, // 2 = "Listening to..."
      details: activity.title.slice(0, 128),
      state: activity.paused
        ? `${activity.artist.slice(0, 120)} (Tạm dừng)`
        : activity.artist.slice(0, 128),
      assets: {
        large_image: activity.coverUrl || "https://tryliner.fun/icon.png",
        large_text: (activity.album || activity.title).slice(0, 128),
        small_image: activity.paused ? "pause" : "play",
        small_text: activity.paused ? "Tạm dừng" : "Đang phát trên Liner",
      },
      buttons: [
        {
          label: "Nghe trên Liner",
          url: "https://tryliner.fun",
        },
      ],
    };

    // Live progress timeline (only while playing)
    if (!activity.paused && endTimestamp) {
      payloadActivity.timestamps = {
        start: startTimestamp,
        end: endTimestamp,
      };
    }

    this.sendPacket(1, {
      cmd: "SET_ACTIVITY",
      args: {
        pid: process.pid,
        activity: payloadActivity,
      },
      nonce: Math.random().toString(36).slice(2),
    });
  }

  public clearActivity(): void {
    this.currentActivity = null;
    if (this.isConnected) {
      this.sendActivityPayload(null);
    }
  }

  public disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      try {
        this.socket.destroy();
      } catch {}
      this.socket = null;
    }
    this.isConnected = false;
  }
}

export const discordRpc = new DiscordRpcClient();
