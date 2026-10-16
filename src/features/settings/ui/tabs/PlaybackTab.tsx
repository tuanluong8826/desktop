import { useState, useEffect } from "react";
import { useTranslation } from "@/languages";
import { usePlayerStore } from "@/features/player";
import { ToggleSwitch, TextInput, Button, useToast } from "@/shared/ui";
import { SettingRow, SettingSection, SegmentedControl } from "../controls";
import {
  DEFAULT_PRIMARY_API,
  FALLBACK_EDGE_API,
  getApiBaseUrl,
  setApiBaseUrl,
  isCustomServer,
  testServerEndpoint,
} from "@/shared/api/baseUrl";

export function PlaybackTab({ searchQuery }: { searchQuery?: string }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [mounted, setMounted] = useState(false);
  const autoplaySimilar = usePlayerStore((state) => state.autoplaySimilar);
  const setAutoplaySimilar = usePlayerStore(
    (state) => state.setAutoplaySimilar,
  );
  const trackDoubleClickBehavior = usePlayerStore(
    (state) => state.trackDoubleClickBehavior,
  );
  const setTrackDoubleClickBehavior = usePlayerStore(
    (state) => state.setTrackDoubleClickBehavior,
  );
  const defaultPlaybackContext = usePlayerStore(
    (state) => state.defaultPlaybackContext,
  );
  const setDefaultPlaybackContext = usePlayerStore(
    (state) => state.setDefaultPlaybackContext,
  );
  const pauseOnDeviceChange = usePlayerStore(
    (state) => state.pauseOnDeviceChange,
  );
  const setPauseOnDeviceChange = usePlayerStore(
    (state) => state.setPauseOnDeviceChange,
  );
  const discordRpcEnabled = usePlayerStore((state) => state.discordRpcEnabled);
  const setDiscordRpcEnabled = usePlayerStore(
    (state) => state.setDiscordRpcEnabled,
  );
  const autoMixEnabled = usePlayerStore((state) => state.autoMixEnabled);
  const setAutoMixEnabled = usePlayerStore((state) => state.setAutoMixEnabled);
  const autoMixDurationSec = usePlayerStore((state) => state.autoMixDurationSec);
  const setAutoMixDurationSec = usePlayerStore(
    (state) => state.setAutoMixDurationSec,
  );
  const autoMixDjFilter = usePlayerStore((state) => state.autoMixDjFilter);
  const setAutoMixDjFilter = usePlayerStore(
    (state) => state.setAutoMixDjFilter,
  );
  const spatialAudioEnabled = usePlayerStore((state) => state.spatialAudioEnabled);
  const setSpatialAudioEnabled = usePlayerStore((state) => state.setSpatialAudioEnabled);
  const soundCheckEnabled = usePlayerStore((state) => state.soundCheckEnabled);
  const setSoundCheckEnabled = usePlayerStore((state) => state.setSoundCheckEnabled);
  const appleDigitalMasterEnabled = usePlayerStore((state) => state.appleDigitalMasterEnabled);
  const setAppleDigitalMasterEnabled = usePlayerStore((state) => state.setAppleDigitalMasterEnabled);

  const [currentApiUrl, setCurrentApiUrl] = useState(() => getApiBaseUrl());
  const [serverMode, setServerMode] = useState<"primary" | "edge" | "custom">(() => {
    const base = getApiBaseUrl();
    if (base === DEFAULT_PRIMARY_API) return "primary";
    if (base === FALLBACK_EDGE_API) return "edge";
    return "custom";
  });
  const [customUrlInput, setCustomUrlInput] = useState(() => {
    return isCustomServer(getApiBaseUrl()) ? getApiBaseUrl() : "http://localhost:3000";
  });
  const [pingStatus, setPingStatus] = useState<{ ok: boolean; status: number; latencyMs: number } | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleServerModeChange = (mode: "primary" | "edge" | "custom") => {
    setServerMode(mode);
    setPingStatus(null);
    if (mode === "primary" || mode === "edge") {
      setApiBaseUrl(DEFAULT_PRIMARY_API);
      setCurrentApiUrl(DEFAULT_PRIMARY_API);
      toast("Đã chuyển sang Máy chủ riêng (miloapi.dev/liner)", "info");
    } else {
      if (customUrlInput.trim()) {
        setApiBaseUrl(customUrlInput.trim());
        setCurrentApiUrl(customUrlInput.trim());
      }
    }
  };

  const handleSaveCustomUrl = () => {
    const trimmed = customUrlInput.trim();
    if (!trimmed) return;
    setApiBaseUrl(trimmed);
    setCurrentApiUrl(trimmed);
    toast(`Đã lưu máy chủ tùy chỉnh: ${trimmed}`, "info");
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setPingStatus(null);
    try {
      const res = await testServerEndpoint(getApiBaseUrl(), 6000);
      setPingStatus(res);
      if (res.ok) {
        toast(`Kết nối thành công (${res.latencyMs}ms)`, "info");
      } else {
        toast(`Kết nối thất bại (HTTP ${res.status || "Error"})`, "error");
      }
    } catch {
      setPingStatus({ ok: false, status: 0, latencyMs: 0 });
      toast("Không thể kết nối máy chủ", "error");
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="flex flex-col gap-[20px]">
      <SettingSection>
        <SettingRow
          title={t("settings.autoplay_similar.title")}
          description={t("settings.autoplay_similar.description")}
          titleKey="settings.autoplay_similar.title"
          descKey="settings.autoplay_similar.description"
          searchQuery={searchQuery}
          control={
            <ToggleSwitch
              checked={autoplaySimilar}
              onChange={setAutoplaySimilar}
            />
          }
        />

        <SettingRow
          title={t("settings.track_double_click.title")}
          description={t("settings.track_double_click.description")}
          titleKey="settings.track_double_click.title"
          descKey="settings.track_double_click.description"
          searchQuery={searchQuery}
          control={
            mounted ? (
              <SegmentedControl
                ariaLabel={t("settings.track_double_click.title")}
                value={trackDoubleClickBehavior}
                onChange={setTrackDoubleClickBehavior}
                options={[
                  {
                    value: "play",
                    label: t("settings.track_double_click.play"),
                  },
                  {
                    value: "queue",
                    label: t("settings.track_double_click.queue"),
                  },
                ]}
              />
            ) : (
              <span />
            )
          }
        />

        <SettingRow
          title={t("settings.default_playback_context.title")}
          description={t("settings.default_playback_context.description")}
          titleKey="settings.default_playback_context.title"
          descKey="settings.default_playback_context.description"
          searchQuery={searchQuery}
          control={
            mounted ? (
              <SegmentedControl
                ariaLabel={t("settings.default_playback_context.title")}
                value={defaultPlaybackContext}
                onChange={setDefaultPlaybackContext}
                options={[
                  {
                    value: "resume",
                    label: t("settings.default_playback_context.resume"),
                  },
                  {
                    value: "empty",
                    label: t("settings.default_playback_context.empty"),
                  },
                ]}
              />
            ) : (
              <span />
            )
          }
        />

        <SettingRow
          title={t("settings.audio.pause_on_device_change.title")}
          description={t("settings.audio.pause_on_device_change.description")}
          titleKey="settings.audio.pause_on_device_change.title"
          descKey="settings.audio.pause_on_device_change.description"
          searchQuery={searchQuery}
          control={
            <ToggleSwitch
              checked={pauseOnDeviceChange}
              onChange={setPauseOnDeviceChange}
            />
          }
        />

        <SettingRow
          title="Discord Rich Presence (RPC)"
          description="Hiển thị bài hát đang nghe, ảnh bìa và thời lượng bài hát lên trang cá nhân Discord (giống Spotify)"
          searchQuery={searchQuery}
          control={
            <ToggleSwitch
              checked={Boolean(discordRpcEnabled)}
              onChange={setDiscordRpcEnabled}
              ariaLabel="Bật tắt Discord Rich Presence"
            />
          }
        />
      </SettingSection>

      <SettingSection label="AutoMix & Chuyển bài mượt mà (Apple Music & Spotify)">
        <SettingRow
          title="AutoMix (Trộn nhạc tự động)"
          description="Tự động hòa âm và chuyển bài mượt mà trước khi kết thúc bằng đường cong Equal-Power Crossfade (chuẩn Apple Music & Spotify), loại bỏ khoảng lặng giữa các bài hát."
          searchQuery={searchQuery}
          control={
            <ToggleSwitch
              checked={autoMixEnabled}
              onChange={setAutoMixEnabled}
              ariaLabel="Bật tắt AutoMix"
            />
          }
        />

        {autoMixEnabled && (
          <>
            <SettingRow
              title="Thời lượng chuyển bài (Crossfade Duration)"
              description="Thời gian hòa âm chồng lấn giữa 2 bài hát. 5s là chuẩn Apple Music, 7s–10s mang lại phong cách Radio/DJ club."
              searchQuery={searchQuery}
              control={
                mounted ? (
                  <SegmentedControl
                    ariaLabel="Thời lượng chuyển bài"
                    value={String(autoMixDurationSec)}
                    onChange={(val) => setAutoMixDurationSec(Number(val))}
                    options={[
                      { value: "3", label: "3s" },
                      { value: "5", label: "5s (Apple)" },
                      { value: "7", label: "7s" },
                      { value: "10", label: "10s" },
                      { value: "12", label: "12s" },
                    ]}
                  />
                ) : (
                  <span />
                )
              }
            />

            <SettingRow
              title="Bộ lọc tần số thấp DJ (Spotify Automix Ducking)"
              description="Tự động lọc dải trầm (bass/sub-bass) của bài hát cũ khi chuyển bài để âm thanh không bị rè hoặc đè lẫn nhau, giữ cho tiếng kick của bài hát mới luôn uy lực."
              searchQuery={searchQuery}
              control={
                <ToggleSwitch
                  checked={autoMixDjFilter}
                  onChange={setAutoMixDjFilter}
                  ariaLabel="Bật tắt bộ lọc DJ Automix"
                />
              }
            />
          </>
        )}
      </SettingSection>

      <SettingSection label="Chất lượng âm thanh phòng thu (Apple Music Audio Master)">
        <SettingRow
          title="Apple Spatial Audio 3D (Âm thanh vòm không gian 3D)"
          description="Mô phỏng trường âm thanh Dolby Atmos 3D đa chiều với độ sâu âm hình, tách bạch nhạc cụ và độ rộng không gian phòng thu cao cấp."
          searchQuery={searchQuery}
          control={
            <ToggleSwitch
              checked={spatialAudioEnabled}
              onChange={setSpatialAudioEnabled}
              ariaLabel="Bật tắt Apple Spatial Audio 3D"
            />
          }
        />

        <SettingRow
          title="Sound Check (Chuẩn hóa âm lượng EBU R128)"
          description="Tự động cân bằng độ lớn âm lượng giữa các bài hát theo chuẩn Apple Music Sound Check (-16 LUFS), loại bỏ cảm giác giật mình khi chuyển giữa các bản nhạc to nhỏ thất thường."
          searchQuery={searchQuery}
          control={
            <ToggleSwitch
              checked={soundCheckEnabled}
              onChange={setSoundCheckEnabled}
              ariaLabel="Bật tắt Sound Check"
            />
          }
        />

        <SettingRow
          title="Apple Digital Master Tuning (Chất âm Hi-Res Lossless)"
          description="Đường cong cân bằng âm thanh độc quyền của Apple: tối ưu độ ấm của âm trầm, tôn vinh giọng ca sĩ (vocal clarity) và tăng độ trong trẻo, mịn màng ở dải tần số cao."
          searchQuery={searchQuery}
          control={
            <ToggleSwitch
              checked={appleDigitalMasterEnabled}
              onChange={setAppleDigitalMasterEnabled}
              ariaLabel="Bật tắt Apple Digital Master Tuning"
            />
          }
        />
      </SettingSection>

      <SettingSection label="Máy chủ API & Kết nối (Server & Endpoint)">
        <SettingRow
          title="Máy chủ phát nhạc (API Server)"
          description="Chọn máy chủ kết nối để tìm kiếm và phát nhạc. Nếu máy chủ chính gặp lỗi 502, hãy chọn Máy chủ Edge dự phòng hoặc máy chủ tự host."
          searchQuery={searchQuery}
          control={
            mounted ? (
              <SegmentedControl
                ariaLabel="Máy chủ phát nhạc"
                value={serverMode}
                onChange={handleServerModeChange}
                options={[
                  { value: "primary", label: "Máy chủ riêng (miloapi.dev)" },
                  { value: "custom", label: "Tùy chỉnh khác" },
                ]}
              />
            ) : (
              <span />
            )
          }
        />

        {serverMode === "custom" && (
          <div className="py-[10px] flex flex-col gap-[8px]">
            <div className="flex items-center gap-[8px]">
              <div className="flex-1">
                <TextInput
                  size="sm"
                  value={customUrlInput}
                  onChange={(e) => setCustomUrlInput(e.target.value)}
                  placeholder="http://localhost:3000 hoặc https://my-server.com"
                />
              </div>
              <Button size="sm" variant="secondary" onClick={handleSaveCustomUrl}>
                Lưu URL
              </Button>
            </div>
            <span className="text-[12px] text-text-tertiary">
              Nhập địa chỉ máy chủ API tự host (Node.js/Python backend).
            </span>
          </div>
        )}

        <div className="flex items-center justify-between py-[10px]">
          <div className="flex items-center gap-[8px] min-w-0">
            <span className="text-[12px] text-text-secondary truncate font-mono">
              {currentApiUrl}
            </span>
            {pingStatus && (
              <span
                className={`text-[11px] px-[6px] py-[2px] rounded shrink-0 ${
                  pingStatus.ok
                    ? "bg-emerald-500/15 text-emerald-400"
                    : "bg-red-500/15 text-red-400"
                }`}
              >
                {pingStatus.ok
                  ? `200 OK (${pingStatus.latencyMs}ms)`
                  : `Lỗi ${pingStatus.status || "Mất kết nối"}`}
              </span>
            )}
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={handleTestConnection}
            disabled={isTesting}
            className="!h-[28px] !text-[12px] shrink-0"
          >
            {isTesting ? "Đang kiểm tra..." : "Kiểm tra kết nối"}
          </Button>
        </div>
      </SettingSection>
    </div>
  );
}
