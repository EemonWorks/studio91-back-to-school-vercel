export default function Doodle({ kind, className = '' }: { kind: 'plane' | 'flower' | 'sun' | 'hearts'; className?: string }) {
  return <svg className={`doodle doodle-${kind} ${className}`} viewBox="0 0 100 100" fill="none" aria-hidden="true"
    stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round">
    {kind === 'plane' && <>
      <path d="M12 40 90 12 65 82 48 56 12 40Z" fill="#b9e8ea" />
      <path d="m48 56 42-44-35 51-6 18-1-25Zm7 7 10 19" />
      <path d="M7 86c22 8 31-4 23-12-9-8-25 7-17 13" strokeDasharray="3 7" />
    </>}
    {kind === 'flower' && <>
      <path d="M48 33c-19-28-34-4-20 11-27 4-23 27 1 25-2 26 24 28 30 5 25 13 40-9 17-22 23-14 3-37-15-22-1-27-28-25-25 1" fill="#f3a5cf" />
      <path d="M39 52c0-15 24-15 25 0s-25 17-25 0Z" fill="#ffe59e" />
      <path d="m45 54 3 2m9-3 2-1" />
    </>}
    {kind === 'sun' && <>
      <circle cx="50" cy="50" r="24" /><path d="M39 54q11 15 23-1M40 43h1m17 0h1" />
      <path d="m50 6 1 9m25 0-5 8M94 41l-10 2m4 24-9-5M68 90l-4-9M40 94l3-10M14 78l8-6M6 48l10 1M18 20l8 7" />
    </>}
    {kind === 'hearts' && <>
      <path d="M16 28C-1 0 59 1 40 34L22 59 7 38C-5 19 10 9 16 28Z" transform="translate(14 6) rotate(-13 22 29)" />
      <path d="M65 64c-14-23-33-2-9 17l15 10 11-15c18-25-9-36-17-12Z" />
    </>}
  </svg>;
}
