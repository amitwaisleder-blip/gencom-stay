// First-launch theme picker. Shows once per browser (key in
// localStorage); user can re-open from the toolbar's theme dropdown
// later. Keeping it simple — four preset cards + a "Custom" entry that
// opens three color pickers inline.

import { useState } from "react";

import type { ThemeKey } from "../lib/types";
import { THEMES, customDefaults, saveCustomDefaults } from "../lib/themes";

const ONBOARD_KEY = "gencom.orgchart.onboarded.v1";

export function shouldShowThemePicker(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return !window.localStorage.getItem(ONBOARD_KEY);
  } catch {
    return false;
  }
}

export function markThemePickerSeen(): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(ONBOARD_KEY, "1"); } catch { /* ignore */ }
}

export function ThemePickerModal({
  onPick,
  onClose,
}: {
  onPick: (theme: ThemeKey) => void;
  onClose: () => void;
}) {
  const [showCustom, setShowCustom] = useState(false);
  const [custom, setCustom] = useState(customDefaults());

  return (
    <div
      className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm grid place-items-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white border border-gencom-sand rounded-xl shadow-2xl max-w-2xl w-full"
      >
        <div className="px-5 py-3 border-b border-gencom-sand">
          <div className="t-eyebrow">Org Chart</div>
          <div className="t-h2 mt-0.5">Pick a theme</div>
          <p className="text-[12px] text-gencom-stone mt-1">
            Sets default colors for new boxes. You can change it later from the toolbar; existing boxes keep their per-box colors.
          </p>
        </div>
        <div className="px-5 py-4 grid grid-cols-2 gap-3">
          {(Object.keys(THEMES) as Array<keyof typeof THEMES>).map((k) => (
            <ThemeCard
              key={k}
              themeKey={k as ThemeKey}
              label={THEMES[k].label}
              description={THEMES[k].description}
              fill={THEMES[k].defaults.fillColor}
              border={THEMES[k].defaults.borderColor}
              text={THEMES[k].defaults.textColor}
              onPick={() => {
                markThemePickerSeen();
                onPick(k as ThemeKey);
              }}
            />
          ))}
        </div>

        <div className="px-5 py-3 border-t border-gencom-sand">
          {!showCustom ? (
            <button
              className="ib-button-ghost text-xs"
              onClick={() => setShowCustom(true)}
            >
              Or pick custom colors…
            </button>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              <ColorField label="Fill" value={custom.fillColor} onChange={(v) => setCustom({ ...custom, fillColor: v })} />
              <ColorField label="Border" value={custom.borderColor} onChange={(v) => setCustom({ ...custom, borderColor: v })} />
              <ColorField label="Text" value={custom.textColor} onChange={(v) => setCustom({ ...custom, textColor: v })} />
              <div className="col-span-3 flex justify-end gap-2 mt-1">
                <button className="ib-button-ghost text-xs" onClick={() => setShowCustom(false)}>Back</button>
                <button
                  className="ib-button-primary text-xs"
                  onClick={() => {
                    saveCustomDefaults(custom);
                    markThemePickerSeen();
                    onPick("custom");
                  }}
                >
                  Use custom
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ThemeCard({
  themeKey, label, description, fill, border, text, onPick,
}: {
  themeKey: ThemeKey;
  label: string;
  description: string;
  fill: string;
  border: string;
  text: string;
  onPick: () => void;
}) {
  void themeKey;
  return (
    <button
      onClick={onPick}
      className="text-left rounded-lg border border-gencom-sand bg-white hover:border-gencom-stone hover:shadow-sm transition p-3"
    >
      <div className="flex items-center gap-3">
        <div
          className="h-12 w-16 rounded-md grid place-items-center"
          style={{ background: fill, border: `1.5px solid ${border}`, color: text }}
        >
          <span className="text-[10px] uppercase tracking-wider font-semibold">LLC</span>
        </div>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-gencom-ink truncate">{label}</div>
          <div className="text-[11.5px] text-gencom-stone truncate">{description}</div>
        </div>
      </div>
    </button>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="block t-eyebrow mb-1">{label}</span>
      <input type="color" className="h-9 w-full rounded-md border border-gencom-sand" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
