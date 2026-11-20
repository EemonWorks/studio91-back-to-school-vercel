import { useId } from 'react';
import { DOODLE_PATHS } from './visual-theme';
import type { DoodleKind, DoodlePath } from './visual-theme';

export default function Doodle({ kind, className = '', medium = 'pen' }: {
  kind: DoodleKind;
  className?: string;
  medium?: 'pen' | 'chalk';
}) {
  const id = `chalk-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const paths: DoodlePath[] = DOODLE_PATHS[kind];
  if (medium === 'chalk' && ['plane', 'hearts', 'sun', 'flower'].includes(kind)) {
    const asset = kind === 'flower' ? 'flowers' : kind;
    return <img className={`doodle doodle-${kind} doodle-chalk ${className}`}
      src={`${import.meta.env.BASE_URL}visuals/chalk-${asset}.webp`} alt="" aria-hidden="true" />;
  }
  return <svg className={`doodle doodle-${kind} doodle-${medium} ${className}`} viewBox="0 0 100 100"
    fill="none" aria-hidden="true" focusable="false" stroke="currentColor" strokeWidth="2.7"
    strokeLinecap="round" strokeLinejoin="round">
    {medium === 'chalk' && <defs>
      <filter id={id} x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency=".75" numOctaves="2" seed="7" result="grain" />
        <feColorMatrix in="grain" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .65 .3" result="chalk-grain" />
        <feComposite in="SourceGraphic" in2="chalk-grain" operator="in" />
      </filter>
    </defs>}
    <g filter={medium === 'chalk' ? `url(#${id})` : undefined}>
      {paths.map((path, index) => <path key={index} d={path.d}
        fill={medium === 'pen' ? path.fill ?? 'none' : 'none'}
        stroke={medium === 'chalk' ? path.color ?? 'currentColor' : 'currentColor'} />)}
    </g>
  </svg>;
}
