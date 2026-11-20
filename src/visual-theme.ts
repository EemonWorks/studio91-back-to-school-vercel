export interface DoodlePath {
  d: string;
  fill?: string;
  color?: string;
}

export const DOODLE_PATHS = {
  plane: [
    { d: 'M12 40 90 12 65 82 48 56 12 40Z', fill: '#b9e8ea' },
    { d: 'm48 56 42-44-35 51-6 18-1-25Zm7 7 10 19' },
    { d: 'M7 86c22 8 31-4 23-12-9-8-25 7-17 13' },
  ],
  flower: [
    { d: 'M48 33c-19-28-34-4-20 11-27 4-23 27 1 25-2 26 24 28 30 5 25 13 40-9 17-22 23-14 3-37-15-22-1-27-28-25-25 1', fill: '#f3a5cf' },
    { d: 'M39 52c0-15 24-15 25 0s-25 17-25 0Z', fill: '#ffe59e' },
    { d: 'm45 54 3 2m9-3 2-1' },
  ],
  sun: [
    { d: 'M74 50a24 24 0 1 1-48 0 24 24 0 0 1 48 0Z', fill: '#fff1b8' },
    { d: 'M39 54q11 15 23-1M40 43h1m17 0h1' },
    { d: 'm50 6 1 9m25 0-5 8M94 41l-10 2m4 24-9-5M68 90l-4-9M40 94l3-10M14 78l8-6M6 48l10 1M18 20l8 7' },
  ],
  hearts: [
    { d: 'M35 29c-16-24-33-4-17 14l20 17 17-22c13-22-13-33-20-9Z', fill: '#f3a5cf' },
    { d: 'M65 64c-14-23-33-2-9 17l15 10 11-15c18-25-9-36-17-12Z', fill: '#fff1b8' },
  ],
  bulb: [
    { d: 'M49 20c-33 0-34 31-20 45l9 12h22l9-12c15-16 9-45-20-45Zm-11 57v12h22V77m-20 18h18', color: '#69bddc', fill: '#e4f4ef' },
    { d: 'M45 76V61L35 48m20 28V61l9-13M40 50q9-15 16 0', color: '#ffd696' },
    { d: 'M50 4v8M19 14l8 8M4 43l12 2M9 67l10-3m62-50-8 8m21 18-11 3m7 24-10-3', color: '#ffd696' },
  ],
  books: [
    { d: 'M20 24 67 13l22 9-47 12-22-10Zm0 0v16l22 12V34m0 18 47-11V22', color: '#ee8dcc', fill: '#f8d8eb' },
    { d: 'm20 42-6 9 29 12 49-12-9-8M14 51v15l29 12V63m0 15 49-12V51', color: '#e5bd79', fill: '#fff1b8' },
    { d: 'm19 68-8 12 31 11 49-12-7-11M11 80v10l31 8 49-10v-9', color: '#69bddc', fill: '#d3eff0' },
  ],
  stars: [
    { d: 'm28 14 6 19 21 1-17 12 5 20-17-12-17 12 6-21L2 34l20-1Z', fill: '#fff1b8' },
    { d: 'm77 47 5 14 15 2-12 9 3 15-12-8-13 8 4-14-12-10 15-2Z', fill: '#f3a5cf' },
  ],
} satisfies Record<string, DoodlePath[]>;

export type DoodleKind = keyof typeof DOODLE_PATHS;
