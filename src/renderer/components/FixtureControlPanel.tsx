import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { FixtureInstance, ChannelDefinition, ChannelType } from '../../shared/types';
import { getRigById } from '../../rigs';
import { useSceneStore } from '../store/useSceneStore';
import { useRoomStore } from '../store/useRoomStore';
import './FixtureControlPanel.css';

interface FixtureControlPanelProps {
  fixture: FixtureInstance;
  onClose: () => void;
  onEditSetup: () => void;
}

/** Maps channel types to CSS accent colours */
const CHANNEL_COLORS: Partial<Record<ChannelType, string>> = {
  red:         '#f74f6a',
  green:       '#4fd97a',
  blue:        '#4fa8f7',
  white:       '#e8e8f0',
  amber:       '#f7a04f',
  uv:          '#b44ff7',
  dimmer:      '#d4d4e8',
  strobe:      '#f7e84f',
  speed:       '#4fd9d9',
  'color-wheel': '#d97acf',
  program:     '#9090b0',
  pan:         '#f79060',
  tilt:        '#60b0f7',
  gobo:        '#b0b04f',
  generic:     '#6a6a8a',
};

/** Detect RGB/RGBW groups in the channel list for colour-picker grouping */
interface RgbGroup {
  label: string;
  redCh: ChannelDefinition;
  greenCh: ChannelDefinition;
  blueCh: ChannelDefinition;
  whiteCh?: ChannelDefinition;
}

function detectRgbGroups(channels: ChannelDefinition[]): { groups: RgbGroup[]; ungrouped: ChannelDefinition[] } {
  const used = new Set<number>();
  const groups: RgbGroup[] = [];

  // Find consecutive R-G-B (and optionally W) groups
  for (let i = 0; i < channels.length - 2; i++) {
    const a = channels[i], b = channels[i + 1], c = channels[i + 2];
    if (
      a.type === 'red' && b.type === 'green' && c.type === 'blue' &&
      b.offset === a.offset + 1 && c.offset === a.offset + 2 &&
      !used.has(a.offset)
    ) {
      const match = a.name.match(/\d+$/);
      const label = match ? `LED ${match[0]}` : `LED ${groups.length + 1}`;

      // Check if a White channel immediately follows the RGB triple
      const w = channels[i + 3];
      const hasWhite = w && w.type === 'white' && w.offset === a.offset + 3;

      groups.push({
        label,
        redCh: a,
        greenCh: b,
        blueCh: c,
        ...(hasWhite ? { whiteCh: w } : {}),
      });
      used.add(a.offset);
      used.add(b.offset);
      used.add(c.offset);
      if (hasWhite) used.add(w.offset);
    }
  }

  const ungrouped = channels.filter((ch) => !used.has(ch.offset));
  return { groups, ungrouped };
}

export default function FixtureControlPanel({ fixture, onClose, onEditSetup }: FixtureControlPanelProps) {
  const rig = getRigById(fixture.rigId);
  const personality = rig?.personalities.find((p) => p.name === fixture.personalityName);
  const channels = personality?.channels ?? [];
  const updateFixture = useRoomStore((s) => s.updateFixture);

  // Channel values: offset → value
  const [values, setValues] = useState<Record<number, number>>(() => {
    const init: Record<number, number> = {};
    channels.forEach((ch) => { init[ch.offset] = ch.defaultValue; });
    return init;
  });

  // Guard: when the user is actively dragging a slider, don't overwrite
  // their value with incoming universe updates.
  const userInteractingRef = useRef(false);

  // ── Sync from live universe on mount ────────────────────────────────────
  useEffect(() => {
    if (typeof window.dmx === 'undefined') return;
    window.dmx.getUniverse().then((res) => {
      if (!res.success || !res.data) return;
      const snapshot = res.data;
      const live: Record<number, number> = {};
      for (const ch of channels) {
        live[ch.offset] = snapshot[fixture.startAddress + ch.offset - 1] ?? ch.defaultValue;
      }
      setValues(live);
    });
  }, [fixture.id]); // re-sync when switching fixtures

  // ── Subscribe to universe push updates (animates sliders during fades) ──
  useEffect(() => {
    if (typeof window.dmx === 'undefined') return;
    const cleanup = window.dmx.onUniverseUpdate((snapshot) => {
      if (userInteractingRef.current) return; // user is dragging — skip
      const live: Record<number, number> = {};
      for (const ch of channels) {
        live[ch.offset] = snapshot[fixture.startAddress + ch.offset - 1] ?? 0;
      }
      setValues(live);
    });
    return cleanup;
  }, [fixture.id, fixture.startAddress, channels]);

  // Throttle DMX sends
  const pendingRef = useRef<Map<number, number>>(new Map());
  const rafRef = useRef<number | null>(null);
  // Track if we already cancelled the fade this drag gesture
  const fadeCancelledRef = useRef(false);

  const flushDmx = useCallback(() => {
    const pending = pendingRef.current;
    if (pending.size === 0) return;
    const entries = Array.from(pending.entries());
    pending.clear();

    if (typeof window.dmx !== 'undefined') {
      // Cancel any active crossfade on the first manual change
      if (!fadeCancelledRef.current) {
        fadeCancelledRef.current = true;
        window.dmx.cancelFade();
      }
      for (const [offset, value] of entries) {
        const address = fixture.startAddress + offset;
        window.dmx.setChannel(address, value);
      }
    }
    rafRef.current = null;
  }, [fixture.startAddress]);

  const setChannelValue = useCallback((offset: number, value: number) => {
    userInteractingRef.current = true;
    setValues((prev) => ({ ...prev, [offset]: value }));
    pendingRef.current.set(offset, value);
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(flushDmx);
    }
    // User manually changed a value → no longer matches any saved scene
    useSceneStore.getState().setActiveScene(null);
  }, [flushDmx]);

  // Called on pointerUp / change-end — re-enable universe push updates
  const handleInteractionEnd = useCallback(() => {
    // Small delay so the last flushDmx completes before we accept push updates again
    setTimeout(() => {
      userInteractingRef.current = false;
      fadeCancelledRef.current = false;
    }, 50);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const { groups, ungrouped: rawUngrouped } = detectRgbGroups(channels);

  // Separate dimmer(s) from other ungrouped channels
  const dimmerChannels = rawUngrouped.filter((ch) => ch.type === 'dimmer');
  const otherChannels = rawUngrouped.filter((ch) => ch.type !== 'dimmer');

  // "All LEDs" colour picker (sets all RGB groups at once)
  const allRgb = groups.length > 0
    ? {
        r: values[groups[0].redCh.offset] ?? 0,
        g: values[groups[0].greenCh.offset] ?? 0,
        b: values[groups[0].blueCh.offset] ?? 0,
      }
    : { r: 0, g: 0, b: 0 };

  const allColorHex = `#${[allRgb.r, allRgb.g, allRgb.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

  const setAllRgb = (hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    for (const grp of groups) {
      setChannelValue(grp.redCh.offset, r);
      setChannelValue(grp.greenCh.offset, g);
      setChannelValue(grp.blueCh.offset, b);
    }
  };

  const handleBlackout = () => {
    channels.forEach((ch) => setChannelValue(ch.offset, 0));
  };

  const handleFullOn = () => {
    channels.forEach((ch) => {
      if (ch.type === 'red' || ch.type === 'green' || ch.type === 'blue' || ch.type === 'white' || ch.type === 'dimmer') {
        setChannelValue(ch.offset, 255);
      }
    });
  };

  return (
    <div className="fixture-control-panel" id="fixture-control-panel">
      {/* Header */}
      <div className="fcp-header">
        <div className="fcp-header-top">
          <div className="fcp-header-title-row">
            <h2>{fixture.label}</h2>
            <button className="fcp-btn-icon" id="btn-edit-setup" onClick={onEditSetup} title="Edit Setup (Name, Mode, Address)">
              ⚙️
            </button>
          </div>
          <button className="fcp-close" id="btn-close-panel" onClick={onClose} title="Close panel">
            ×
          </button>
        </div>
        
        <span className="fcp-header-meta">
          {personality?.name} · CH {fixture.startAddress}–{fixture.startAddress + fixture.channelCount - 1}
        </span>
        
        <div className="fcp-header-actions">
          <button className="fcp-btn" id="btn-blackout" onClick={handleBlackout} title="All channels to 0">
            Blackout
          </button>
          <button className="fcp-btn fcp-btn-accent" id="btn-full-on" onClick={handleFullOn} title="Full colour">
            Full On
          </button>
        </div>
      </div>



      <div className="fcp-body">
        {/* ── Master dimmer — always at the very top ────────────── */}
        {dimmerChannels.length > 0 && (
          <section className="fcp-section" id="section-dimmer">
            <div className="fcp-slider-list">
              {dimmerChannels.map((ch) => (
                <ChannelSlider
                  key={ch.offset}
                  channel={ch}
                  value={values[ch.offset] ?? ch.defaultValue}
                  onChange={setChannelValue}
                  onInteractionEnd={handleInteractionEnd}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── Colour section ───────────────────────────────────── */}
        {groups.length > 0 && (
          <section className="fcp-section" id="section-colour">
            <h3 className="fcp-section-title">Colour</h3>

            {/* Master colour picker — sets ALL LEDs at once */}
            {groups.length > 1 && (
              <div className="fcp-color-master">
                <label className="fcp-color-label">All LEDs</label>
                <div className="fcp-color-row">
                  <input
                    type="color"
                    className="fcp-color-input"
                    id="input-color-all"
                    value={allColorHex}
                    onChange={(e) => { setAllRgb(e.target.value); handleInteractionEnd(); }}
                  />
                  <div
                    className="fcp-color-preview"
                    style={{ background: allColorHex }}
                  />
                  <span className="fcp-color-hex mono">{allColorHex.toUpperCase()}</span>
                </div>
              </div>
            )}

            {/* Per-LED colour pickers */}
            <div className="fcp-color-grid">
              {groups.map((grp) => {
                const r = values[grp.redCh.offset] ?? 0;
                const g = values[grp.greenCh.offset] ?? 0;
                const b = values[grp.blueCh.offset] ?? 0;
                const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
                return (
                  <div className="fcp-color-led" key={grp.label} id={`color-${grp.label.replace(/\s/g, '-')}`}>
                    <label className="fcp-color-label">{grp.label}</label>
                    <div className="fcp-color-row">
                      <input
                        type="color"
                        className="fcp-color-input"
                        value={hex}
                        onChange={(e) => {
                          const rv = parseInt(e.target.value.slice(1, 3), 16);
                          const gv = parseInt(e.target.value.slice(3, 5), 16);
                          const bv = parseInt(e.target.value.slice(5, 7), 16);
                          setChannelValue(grp.redCh.offset, rv);
                          setChannelValue(grp.greenCh.offset, gv);
                          setChannelValue(grp.blueCh.offset, bv);
                          handleInteractionEnd();
                        }}
                      />
                      <div className="fcp-color-preview" style={{ background: hex }} />
                    </div>
                    {/* R/G/B/W sliders */}
                    <ChannelSlider channel={grp.redCh}   value={r} onChange={setChannelValue} onInteractionEnd={handleInteractionEnd} />
                    <ChannelSlider channel={grp.greenCh} value={g} onChange={setChannelValue} onInteractionEnd={handleInteractionEnd} />
                    <ChannelSlider channel={grp.blueCh}  value={b} onChange={setChannelValue} onInteractionEnd={handleInteractionEnd} />
                    {grp.whiteCh && (
                      <ChannelSlider
                        channel={grp.whiteCh}
                        value={values[grp.whiteCh.offset] ?? grp.whiteCh.defaultValue}
                        onChange={setChannelValue}
                        onInteractionEnd={handleInteractionEnd}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Other channels ──────────────────────────────────── */}
        {otherChannels.length > 0 && (
          <section className="fcp-section" id="section-channels">
            <h3 className="fcp-section-title">Channels</h3>
            <div className="fcp-slider-list">
              {otherChannels.map((ch) => (
                <ChannelSlider
                  key={ch.offset}
                  channel={ch}
                  value={values[ch.offset] ?? ch.defaultValue}
                  onChange={setChannelValue}
                  onInteractionEnd={handleInteractionEnd}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

/* ── Individual channel slider ────────────────────────────────────────────── */

interface ChannelSliderProps {
  channel: ChannelDefinition;
  value: number;
  onChange: (offset: number, value: number) => void;
  onInteractionEnd?: () => void;
}

function ChannelSlider({ channel, value, onChange, onInteractionEnd }: ChannelSliderProps) {
  const color = CHANNEL_COLORS[channel.type] ?? CHANNEL_COLORS.generic!;
  const pct = ((value - channel.minValue) / (channel.maxValue - channel.minValue)) * 100;

  return (
    <div className="fcp-slider" id={`slider-${channel.name.replace(/\s/g, '-')}`}>
      <label className="fcp-slider-label" title={channel.notes ?? ''}>
        <span className="fcp-slider-dot" style={{ background: color }} />
        {channel.name}
      </label>
      <input
        type="range"
        className="fcp-slider-input"
        min={channel.minValue}
        max={channel.maxValue}
        value={value}
        onChange={(e) => onChange(channel.offset, parseInt(e.target.value))}
        onPointerUp={onInteractionEnd}
        onTouchEnd={onInteractionEnd}
        style={{
          background: `linear-gradient(to right, ${color} ${pct}%, var(--color-surface-3) ${pct}%)`,
        }}
      />
      <span className="fcp-slider-value mono">{value}</span>
    </div>
  );
}
