/**
 * Logo de Weaver — "W" geométrica tejida (4 trazos en zigzag).
 *
 * Vectorizada desde el PNG oficial del logo (1024x947 → viewBox 576x372).
 * Se embebe inline con `currentColor` para heredar el color del contexto
 * (típicamente el accent del tema); un <img> no permitiría tintar.
 *
 * Proporción del logo: ancho ≈ alto × 1.548. El prop `size` define el ALTO.
 */

export function WeaverLogo({ size = 20, className = '' }: { size?: number; className?: string }) {
  const W = 576;
  const H = 372;
  const width = Math.round(size * (W / H) * 100) / 100;

  return (
    <svg
      width={width}
      height={size}
      viewBox="0 0 576 372"
      preserveAspectRatio="xMidYMid meet"
      className={className}
      style={{ color: 'currentColor' }}
      aria-label="Weaver"
      role="img"
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        stroke="none"
        d="M228 171L222 176L155 301L156 307L197 368L205 365L270 252L233 175Z M291 46L286 49L249 122L250 128L375 362L382 366L425 301L425 293L296 48Z M571 4L500 4L496 7L418 148L415 158L402 178L402 185L438 250L443 250L552 52L555 42L572 14Z M7 4L4 8L139 259L144 259L181 192L80 4Z"
      />
    </svg>
  );
}
