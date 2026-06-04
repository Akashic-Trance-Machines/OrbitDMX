/**
 * HtsColorPicker — standalone reusable colour picker.
 *
 * Exports:
 *   HtsColorPicker  – RGB-based (r,g,b props + onChange(r,g,b)), with optional preset swatches
 *   HexColorPicker  – hex-string convenience wrapper (hex prop + onChange(hex)), no swatches
 */
import React, { useState, useEffect, useRef } from 'react';
import type { ColourPreset } from '../store/useColourStore';
import './HtsColorPicker.css';

// ─── Math helpers ─────────────────────────────────────────────────────────────

export function hueToRgb(h: number): { r: number; g: number; b: number } {
  const x = 1 - Math.abs(((h / 60) % 2) - 1);
  let r = 0, g = 0, b = 0;
  if (0 <= h && h < 60)        { r = 255; g = 255 * x; b = 0; }
  else if (60 <= h && h < 120) { r = 255 * x; g = 255; b = 0; }
  else if (120 <= h && h < 180){ r = 0; g = 255; b = 255 * x; }
  else if (180 <= h && h < 240){ r = 0; g = 255 * x; b = 255; }
  else if (240 <= h && h < 300){ r = 255 * x; g = 0; b = 255; }
  else if (300 <= h && h <= 360){ r = 255; g = 0; b = 255 * x; }
  return { r: Math.round(r), g: Math.round(g), b: Math.round(b) };
}

export function rgbToHts(r: number, g: number, b: number): { h: number; t: number; s: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === r)      h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else if (max === b) h = 60 * ((r - g) / delta + 4);
    if (h < 0) h += 360;
  }

  const s = max / 255;
  const t = max === 0 ? 0 : delta / max;
  return { h: Math.round(h), t, s };
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const c = hex.replace('#', '');
  return {
    r: parseInt(c.substring(0, 2), 16),
    g: parseInt(c.substring(2, 4), 16),
    b: parseInt(c.substring(4, 6), 16),
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

// ─── HtsColorPicker ───────────────────────────────────────────────────────────

export interface HtsColorPickerProps {
  label?: string;
  r: number;
  g: number;
  b: number;
  onChange: (r: number, g: number, b: number) => void;
  onInteractionEnd?: () => void;
  presets?: ColourPreset[];
  /** Canvas diameter in pixels (default 180) */
  size?: number;
  /** Hide the label/hex header */
  hideHeader?: boolean;
}

export function HtsColorPicker({
  label,
  r,
  g,
  b,
  onChange,
  onInteractionEnd,
  presets,
  size = 180,
  hideHeader = false,
}: HtsColorPickerProps) {
  const xc = size / 2;
  const yc = size / 2;
  const R_outer = size * 0.478;
  const R_inner = size * 0.389;
  const R_tri   = size * 0.367;

  const { h: initialH, t: initialT, s: initialS } = rgbToHts(r, g, b);
  const [h, setH] = useState(initialH);
  const [t, setT] = useState(initialT);
  const [s, setS] = useState(initialS);

  const hRef = useRef(initialH);
  useEffect(() => { hRef.current = h; }, [h]);

  const canvasRef    = useRef<HTMLCanvasElement | null>(null);
  const draggingRef  = useRef<'hue' | 'triangle' | null>(null);

  // Sync when RGB changes externally (fades, preset clicks, etc.)
  useEffect(() => {
    const { h: newH, t: newT, s: newS } = rgbToHts(r, g, b);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max !== min) setH(newH);   // preserve hue on grayscale
    setT(newT);
    setS(newS);
  }, [r, g, b]);

  const activeHex = rgbToHex(r, g, b);

  // ── Canvas rendering ──────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const angleRad = (h * Math.PI) / 180;
    const xa = xc + R_tri * Math.cos(angleRad);
    const ya = yc + R_tri * Math.sin(angleRad);
    const xb = xc + R_tri * Math.cos(angleRad + (2 * Math.PI) / 3);
    const yb = yc + R_tri * Math.sin(angleRad + (2 * Math.PI) / 3);
    const xc_tri = xc + R_tri * Math.cos(angleRad + (4 * Math.PI) / 3);
    const yc_tri = yc + R_tri * Math.sin(angleRad + (4 * Math.PI) / 3);

    const imgData = ctx.createImageData(size, size);
    const data = imgData.data;
    const pureHue = hueToRgb(h);
    const det = (yb - yc_tri) * (xa - xc_tri) + (xc_tri - xb) * (ya - yc_tri);
    const lenA = Math.sqrt((xb - xc_tri) ** 2 + (yb - yc_tri) ** 2);
    const lenB = Math.sqrt((xa - xc_tri) ** 2 + (ya - yc_tri) ** 2);
    const lenC = Math.sqrt((xa - xb) ** 2    + (ya - yb) ** 2);
    const scaleA = Math.abs(det) / lenA;
    const scaleB = Math.abs(det) / lenB;
    const scaleC = Math.abs(det) / lenC;
    const smoothstep = (x: number) => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);

    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const wa = ((yb - yc_tri) * (px - xc_tri) + (xc_tri - xb) * (py - yc_tri)) / det;
        const wb = ((yc_tri - ya) * (px - xc_tri) + (xa - xc_tri) * (py - yc_tri)) / det;
        const wc = 1 - wa - wb;
        const idx = (py * size + px) * 4;
        const alpha = smoothstep(wa * scaleA + 0.5) * smoothstep(wb * scaleB + 0.5) * smoothstep(wc * scaleC + 0.5);
        if (alpha <= 0) { data[idx + 3] = 0; continue; }
        const cwa = Math.max(0, wa), cwb = Math.max(0, wb), cwc = Math.max(0, wc);
        const sum = cwa + cwb + cwc;
        const nwa = sum === 0 ? 1 : cwa / sum;
        const nwb = sum === 0 ? 0 : cwb / sum;
        data[idx]     = Math.round(nwa * pureHue.r + nwb * 255);
        data[idx + 1] = Math.round(nwa * pureHue.g + nwb * 255);
        data[idx + 2] = Math.round(nwa * pureHue.b + nwb * 255);
        data[idx + 3] = Math.round(alpha * 255);
      }
    }

    const offscreen = document.createElement('canvas');
    offscreen.width = size; offscreen.height = size;
    const oCtx = offscreen.getContext('2d')!;
    oCtx.putImageData(imgData, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(offscreen, 0, 0);

    // Hue ring
    const gradient = ctx.createConicGradient(0, xc, yc);
    gradient.addColorStop(0,   '#ff0000');
    gradient.addColorStop(1/6, '#ffff00');
    gradient.addColorStop(2/6, '#00ff00');
    gradient.addColorStop(3/6, '#00ffff');
    gradient.addColorStop(4/6, '#0000ff');
    gradient.addColorStop(5/6, '#ff00ff');
    gradient.addColorStop(1,   '#ff0000');
    ctx.beginPath();
    ctx.arc(xc, yc, (R_outer + R_inner) / 2, 0, Math.PI * 2);
    ctx.strokeStyle = gradient;
    ctx.lineWidth = R_outer - R_inner;
    ctx.stroke();

    // Hue tick
    ctx.beginPath();
    ctx.moveTo(xc + R_inner * Math.cos(angleRad), yc + R_inner * Math.sin(angleRad));
    ctx.lineTo(xc + R_outer * Math.cos(angleRad), yc + R_outer * Math.sin(angleRad));
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Selection handle
    const wa2 = s * t, wb2 = s * (1 - t), wc2 = 1 - s;
    const hx = wa2 * xa + wb2 * xb + wc2 * xc_tri;
    const hy = wa2 * ya + wb2 * yb + wc2 * yc_tri;
    ctx.beginPath();
    ctx.arc(hx, hy, 4, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.beginPath();
    ctx.arc(hx, hy, 5, 0, Math.PI * 2);
    ctx.strokeStyle = '#000000'; ctx.lineWidth = 0.8; ctx.stroke();
  }, [h, r, g, b, t, s, size, xc, yc, R_outer, R_inner, R_tri]);

  // ── Drag logic ────────────────────────────────────────────────────────────
  const updateColor = (newH: number, newT: number, newS: number) => {
    setH(newH); setT(newT); setS(newS);
    const hue = hueToRgb(newH);
    const rt = newT * hue.r + (1 - newT) * 255;
    const gt = newT * hue.g + (1 - newT) * 255;
    const bt = newT * hue.b + (1 - newT) * 255;
    onChange(
      Math.min(255, Math.max(0, Math.round(newS * rt))),
      Math.min(255, Math.max(0, Math.round(newS * gt))),
      Math.min(255, Math.max(0, Math.round(newS * bt))),
    );
  };

  const handleDrag = (px: number, py: number, mode: 'hue' | 'triangle') => {
    if (mode === 'hue') {
      let angleDeg = Math.round((Math.atan2(py - yc, px - xc) * 180) / Math.PI);
      if (angleDeg < 0) angleDeg += 360;
      updateColor(angleDeg, t, s);
    } else {
      const currentH = hRef.current;
      const angleRad = (currentH * Math.PI) / 180;
      const xa = xc + R_tri * Math.cos(angleRad);
      const ya = yc + R_tri * Math.sin(angleRad);
      const xb = xc + R_tri * Math.cos(angleRad + (2 * Math.PI) / 3);
      const yb = yc + R_tri * Math.sin(angleRad + (2 * Math.PI) / 3);
      const xc_tri = xc + R_tri * Math.cos(angleRad + (4 * Math.PI) / 3);
      const yc_tri = yc + R_tri * Math.sin(angleRad + (4 * Math.PI) / 3);
      const det = (yb - yc_tri) * (xa - xc_tri) + (xc_tri - xb) * (ya - yc_tri);
      let wa = ((yb - yc_tri) * (px - xc_tri) + (xc_tri - xb) * (py - yc_tri)) / det;
      let wb = ((yc_tri - ya) * (px - xc_tri) + (xa - xc_tri) * (py - yc_tri)) / det;
      let wc = 1 - wa - wb;
      if (wa < 0) wa = 0; if (wb < 0) wb = 0; if (wc < 0) wc = 0;
      const sum = wa + wb + wc;
      if (sum > 0) { wa /= sum; wb /= sum; wc /= sum; } else { wa = 1; wb = 0; wc = 0; }
      const newS = Math.min(1, Math.max(0, 1 - wc));
      const newT = newS === 0 ? 0 : Math.min(1, Math.max(0, wa / newS));
      updateColor(currentH, newT, newS);
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current; if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    const dist = Math.sqrt((px - xc) ** 2 + (py - yc) ** 2);
    draggingRef.current = (dist >= R_inner - 4 && dist <= R_outer + 4) ? 'hue' : 'triangle';
    handleDrag(px, py, draggingRef.current);
    canvas.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!draggingRef.current) return;
    const canvas = canvasRef.current; if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    handleDrag(e.clientX - rect.left, e.clientY - rect.top, draggingRef.current);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (draggingRef.current) { draggingRef.current = null; onInteractionEnd?.(); }
    try { canvasRef.current?.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  };

  return (
    <div className="hts-picker">
      {!hideHeader && (
        <div className="hts-header">
          {label && <label className="hts-title">{label}</label>}
          <div className="hts-preview-row">
            <div className="hts-preview-circle" style={{ backgroundColor: activeHex }} />
            <span className="hts-hex mono">{activeHex.toUpperCase()}</span>
          </div>
        </div>
      )}

      <div className="hts-body">
        <div className="hts-canvas-wrap">
          <canvas
            ref={canvasRef}
            width={size}
            height={size}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className="hts-canvas"
          />
        </div>

        {presets && presets.length > 0 && (
          <div className="hts-swatches">
            {presets.map((preset, i) => (
              <button
                key={preset.id || i}
                className="hts-swatch"
                style={{ background: preset.hex }}
                title={preset.name}
                onClick={() => {
                  const { r: sr, g: sg, b: sb } = hexToRgb(preset.hex);
                  onChange(sr, sg, sb);
                  onInteractionEnd?.();
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── HexColorPicker — convenient hex-string wrapper ───────────────────────────

export interface HexColorPickerProps {
  hex: string;
  onChange: (hex: string) => void;
  onInteractionEnd?: () => void;
  /** Canvas diameter in pixels (default 160) */
  size?: number;
}

export function HexColorPicker({ hex, onChange, onInteractionEnd, size = 160 }: HexColorPickerProps) {
  const { r, g, b } = hexToRgb(hex);
  return (
    <HtsColorPicker
      r={r}
      g={g}
      b={b}
      onChange={(nr, ng, nb) => onChange(rgbToHex(nr, ng, nb))}
      onInteractionEnd={onInteractionEnd}
      size={size}
      hideHeader
    />
  );
}
