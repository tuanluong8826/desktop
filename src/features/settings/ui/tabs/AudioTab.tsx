import { useState, useEffect } from "react";
import { FolderOpenLine } from "@mingcute/react";
import { useToast, ToggleSwitch } from "@/shared/ui";
import Button from "@/shared/ui/Button";
import { useTranslation } from "@/languages";
import {
  usePlayerStore,
  type AudioQuality,
  audioEnhancer,
  EQ_BANDS,
  EQ_PRESETS,
  type EqPresetName,
} from "@/features/player";
import { Select } from "@/shared/ui";
import { useConnectivityStore } from "@/features/connectivity";
import { SettingRow, SettingSection, SettingBlock } from "../controls";

export function AudioTab({ searchQuery }: { searchQuery?: string }) {
  const { t } = useTranslation();
  const [mounted, setMounted] = useState(false);
  const { toast } = useToast();
  const [dumpExported, setDumpExported] = useState(false);
  const audioQuality = usePlayerStore((state) => state.audioQuality);
  const setAudioQuality = usePlayerStore((state) => state.setAudioQuality);
  const connRunning = useConnectivityStore((s) => s.running);
  const connChecks = useConnectivityStore((s) => s.checks);
  const connLastRunAt = useConnectivityStore((s) => s.lastRunAt);
  const runAndSaveDump = useConnectivityStore((s) => s.runAndSaveDump);

  // Audio Enhancer states
  const [eqEnabled, setEqEnabled] = useState(true);
  const [selectedPreset, setSelectedPreset] = useState<EqPresetName>("flat");
  const [eqGains, setEqGains] = useState<number[]>([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const [bassBoost, setBassBoost] = useState<number>(0);
  const [compressorEnabled, setCompressorEnabled] = useState(true);

  useEffect(() => {
    setMounted(true);
    const cfg = audioEnhancer.getConfig();
    setEqEnabled(cfg.eqEnabled);
    setEqGains([...cfg.eqGains]);
    setBassBoost(cfg.bassBoostLevel);
    setCompressorEnabled(cfg.compressorEnabled);
  }, []);

  const handlePresetChange = (presetKey: string) => {
    const key = presetKey as EqPresetName;
    setSelectedPreset(key);
    audioEnhancer.applyPreset(key);
    setEqGains([...audioEnhancer.getConfig().eqGains]);
  };

  const handleBandGainChange = (index: number, gain: number) => {
    audioEnhancer.setEqBandGain(index, gain);
    const updated = [...eqGains];
    updated[index] = gain;
    setEqGains(updated);
  };

  const handleBassBoostChange = (level: number) => {
    setBassBoost(level);
    audioEnhancer.setBassBoost(level);
  };

  const handleToggleEq = (enabled: boolean) => {
    setEqEnabled(enabled);
    audioEnhancer.toggleEq(enabled);
  };

  const handleToggleCompressor = (enabled: boolean) => {
    setCompressorEnabled(enabled);
    audioEnhancer.toggleCompressor(enabled);
  };

  // lossless is listed as unavailable, so the picker only offers live tiers
  const quality: Exclude<AudioQuality, "lossless"> =
    audioQuality === "lossless" ? "high" : audioQuality;

  return (
    <div className="flex flex-col gap-[16px]">
      <SettingSection label="Chất Lượng Âm Thanh">
        <SettingRow
          title={t("settings.audio.title")}
          description={t("settings.audio.description")}
          titleKey="settings.audio.title"
          descKey="settings.audio.description"
          searchQuery={searchQuery}
          control={
            mounted ? (
              <Select
                aria-label={t("settings.audio.title")}
                className="w-[210px]"
                value={quality}
                onChange={setAudioQuality}
                options={[
                  { value: "low", label: t("settings.audio.low") },
                  { value: "standard", label: t("settings.audio.standard") },
                  { value: "high", label: t("settings.audio.high") },
                ]}
              />
            ) : (
              <span />
            )
          }
        />
      </SettingSection>

      <SettingSection label="Nâng Cấp Âm Thanh Chuyên Nghiệp (Audio DSP)">
        <SettingRow
          title="Bộ Cân Bằng Âm Thanh (10-Band Equalizer)"
          description="Tinh chỉnh chi tiết 10 dải tần số âm thanh từ Sub-bass 32Hz đến Dải cao 16kHz"
          searchQuery={searchQuery}
          control={
            <ToggleSwitch
              checked={eqEnabled}
              onChange={handleToggleEq}
              ariaLabel="Bật tắt Equalizer"
            />
          }
        />

        {eqEnabled && (
          <SettingBlock
            title="Cấu Hình Âm Sắc (EQ Preset)"
            description="Chọn nhanh các cấu hình âm thanh chuẩn phòng thu"
            searchQuery={searchQuery}
          >
            <div className="flex flex-col gap-[14px]">
              <div className="w-[240px]">
                <Select
                  value={selectedPreset}
                  onChange={handlePresetChange}
                  options={Object.entries(EQ_PRESETS).map(([k, v]) => ({
                    value: k,
                    label: v.name,
                  }))}
                />
              </div>

              {/* 10-Band Interactive Sliders */}
              <div className="grid grid-cols-5 sm:grid-cols-10 gap-2 p-3 rounded-xl bg-background-secondary border border-border-primary">
                {EQ_BANDS.map((band, idx) => {
                  const gain = eqGains[idx] ?? 0;
                  return (
                    <div
                      key={band.label}
                      className="flex flex-col items-center gap-1.5 min-w-0"
                    >
                      <span className="text-[10px] text-text-tertiary font-mono">
                        {gain > 0 ? `+${gain}` : gain}dB
                      </span>
                      <input
                        type="range"
                        min="-12"
                        max="12"
                        step="1"
                        value={gain}
                        onChange={(e) =>
                          handleBandGainChange(idx, Number(e.target.value))
                        }
                        className="w-full h-20 accent-accent cursor-pointer [writing-mode:vertical-lr] [direction:rtl]"
                      />
                      <span className="text-[11px] font-medium text-text-secondary truncate">
                        {band.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </SettingBlock>
        )}

        <SettingRow
          title="Tăng Cường Âm Trầm (Deep Sub-Bass Boost)"
          description="Khuếch đại dải siêu trầm (dưới 80Hz) cho âm bass sâu, chắc và có lực hơn"
          searchQuery={searchQuery}
          control={
            <div className="flex items-center gap-3 w-[200px]">
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={bassBoost}
                onChange={(e) => handleBassBoostChange(Number(e.target.value))}
                className="w-full accent-accent cursor-pointer"
              />
              <span className="text-xs font-mono text-text-secondary min-w-[36px]">
                {Math.round(bassBoost * 100)}%
              </span>
            </div>
          }
        />

        <SettingRow
          title="Bộ Nén Động Học & Chống Vỡ Tiếng (Studio Limiter)"
          description="Tự động nén dải động, bảo vệ loa và tai nghe khỏi hiện tượng méo tiếng khi tăng âm lượng"
          searchQuery={searchQuery}
          control={
            <ToggleSwitch
              checked={compressorEnabled}
              onChange={handleToggleCompressor}
              ariaLabel="Bật tắt Studio Limiter"
            />
          }
        />
      </SettingSection>

      <SettingSection label={t("settings.connection.title")}>
        <SettingRow
          title={t("settings.connection.checks_title")}
          titleKey="settings.connection.checks_title"
          searchQuery={searchQuery}
          description={
            connChecks.length > 0 && connLastRunAt
              ? t("settings.connection.last_run", {
                  ok: connChecks.filter((c) => c.status === "ok").length,
                  total: connChecks.length,
                  time: new Date(connLastRunAt).toLocaleTimeString(),
                })
              : t("settings.connection.never_run")
          }
          control={
            <div className="flex items-center gap-[8px]">
              {dumpExported && (
                <Button
                  variant="secondary"
                  type="button"
                  onClick={async () => {
                    const targetPath =
                      useConnectivityStore.getState().lastSavedDumpPath ||
                      undefined;
                    if (window.linerElectron?.openExportFolder) {
                      await window.linerElectron.openExportFolder(targetPath);
                    } else if (window.linerElectron?.openDownloads) {
                      await window.linerElectron.openDownloads(targetPath);
                    } else {
                      toast(t("settings.connection.open_folder"), "info");
                    }
                  }}
                  title={t("settings.connection.open_folder")}
                  aria-label={t("settings.connection.open_folder")}
                  className="!h-[34px] !w-[34px] !px-0"
                >
                  <FolderOpenLine size={18} />
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                type="button"
                disabled={connRunning}
                onClick={async () => {
                  const res = await runAndSaveDump();
                  if (res.success) {
                    setDumpExported(true);
                    toast(t("settings.connection.saved"), "success");
                  } else if (!res.canceled) {
                    toast(t("settings.connection.failed"), "error");
                  }
                }}
              >
                {connRunning
                  ? t("settings.connection.checking")
                  : t("settings.connection.button")}
              </Button>
            </div>
          }
        />
      </SettingSection>
    </div>
  );
}
