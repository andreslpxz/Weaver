/**
 * VoiceOrb — esfera animada con estado visual del Modo Live.
 *
 * Estados:
 *   - idle:        breathe suave, gris
 *   - listening:   breathe activo + ripples, accent
 *   - thinking:    spin-slow + pulse, warning
 *   - speaking:    waveform bars, accent-strong
 *   - error:       pulse danger
 */

import { useVoiceStore, type VoiceState } from '@/store/voice';

const STATE_LABEL: Record<VoiceState, string> = {
  idle: 'Inactivo',
  listening: 'Escuchando…',
  thinking: 'Pensando…',
  speaking: 'Hablando…',
  error: 'Error',
};

export function VoiceOrb({ size = 200 }: { size?: number }) {
  const state = useVoiceStore((s) => s.state);

  const baseColor =
    state === 'error' ? 'bg-danger'
    : state === 'thinking' ? 'bg-warning'
    : state === 'speaking' ? 'bg-accent-strong'
    : 'bg-accent';

  const animation =
    state === 'listening' ? 'animate-breathe-active'
    : state === 'thinking' ? 'animate-spin-slow'
    : state === 'speaking' ? 'animate-breathe-active'
    : state === 'error' ? 'animate-pulse-soft'
    : 'animate-breathe';

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      {/* Ripples (solo en listening) */}
      {state === 'listening' && (
        <>
          <div
            className="absolute inset-0 rounded-full bg-accent/20 animate-ripple"
            style={{ animationDelay: '0s' }}
          />
          <div
            className="absolute inset-0 rounded-full bg-accent/15 animate-ripple"
            style={{ animationDelay: '0.6s' }}
          />
          <div
            className="absolute inset-0 rounded-full bg-accent/10 animate-ripple"
            style={{ animationDelay: '1.2s' }}
          />
        </>
      )}

      {/* Glow halo */}
      <div
        className={`absolute inset-4 rounded-full ${baseColor} opacity-20 blur-2xl ${animation}`}
      />

      {/* Orb principal */}
      <div
        className={`relative rounded-full ${baseColor} ${animation} shadow-2xl flex items-center justify-center overflow-hidden`}
        style={{ width: size * 0.7, height: size * 0.7 }}
      >
        {/* Brillo superior */}
        <div
          className="absolute top-0 left-1/4 right-1/4 h-1/3 rounded-full bg-white/30 blur-md"
        />

        {/* Waveform bars (en speaking) */}
        {state === 'speaking' && (
          <div className="absolute inset-0 flex items-center justify-center gap-1">
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                className="w-1 bg-white/80 rounded-full animate-waveform"
                style={{
                  height: '40%',
                  animationDelay: `${i * 0.08}s`,
                  animationDuration: `${0.6 + (i % 3) * 0.15}s`,
                }}
              />
            ))}
          </div>
        )}

        {/* Spinner ring (en thinking) */}
        {state === 'thinking' && (
          <div className="absolute inset-2 rounded-full border-2 border-white/30 border-t-white animate-spin" />
        )}

        {/* Icono central (idle/error) */}
        {(state === 'idle' || state === 'error') && (
          <svg
            viewBox="0 0 24 24"
            className="w-1/3 h-1/3 text-white/90"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="22" />
          </svg>
        )}
      </div>

      {/* Label de estado */}
      <div className="absolute -bottom-8 left-0 right-0 text-center">
        <span className="text-xs text-text-secondary uppercase tracking-wider font-medium">
          {STATE_LABEL[state]}
        </span>
      </div>
    </div>
  );
}
