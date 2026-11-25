/* ============================================================================
   Slider.tsx — ползунок интенсивности 1–5 (design.md §5.4).
   ========================================================================== */

import './Slider.css';
import type { Intensity } from '../../core/types';

const LEVELS: Array<{ value: Intensity; short: string; title: string; allow: string }> = [
  {
    value: 1,
    short: 'косметика',
    title: 'Косметика',
    allow: 'Меняются только слова внутри предложения и убирается канцелярит. Длина и порядок не меняются.',
  },
  {
    value: 2,
    short: 'лёгкая',
    title: 'Лёгкая',
    allow: 'Предложение переформулируется, длинное делится на два. Абзацы и тезисы остаются на местах.',
  },
  {
    value: 3,
    short: 'базовая',
    title: 'Базовая',
    allow: 'Предложение переписывается целиком, пассив заменяется активом. Порядок предложений сохраняется.',
  },
  {
    value: 4,
    short: 'смелая',
    title: 'Смелая',
    allow: 'Предложения внутри абзаца переставляются, короткие объединяются, добавляются связки.',
  },
  {
    value: 5,
    short: 'пересказ',
    title: 'Свободный пересказ',
    allow: 'Абзац переписывается заново в прозе. Порядок абзацев и факты не меняются.',
  },
];

export interface IntensitySliderProps {
  value: Intensity;
  onChange: (v: Intensity) => void;
  disabled?: boolean;
}

export function IntensitySlider({ value, onChange, disabled }: IntensitySliderProps) {
  const current = LEVELS.find((l) => l.value === value) ?? LEVELS[2];
  return (
    <div className="slider">
      <div className="slider__head">
        <span className="slider__value">
          {value} · {current.title}
        </span>
      </div>

      <input
        type="range"
        min={1}
        max={5}
        step={1}
        value={value}
        disabled={disabled}
        aria-label="Интенсивность правок"
        aria-valuetext={`${value} из 5, ${current.title}`}
        onChange={(e) => onChange(Number(e.target.value) as Intensity)}
        className="slider__input"
        style={{ ['--fill' as string]: `${((value - 1) / 4) * 100}%` }}
      />

      <div className="slider__scale" aria-hidden="true">
        {LEVELS.map((l) => (
          <span key={l.value} className={`slider__tick${l.value === value ? ' slider__tick--active' : ''}`}>
            {l.value} {l.short}
          </span>
        ))}
      </div>

      <p className="slider__hint">{current.allow}</p>
    </div>
  );
}

export const INTENSITY_LEVELS = LEVELS;
