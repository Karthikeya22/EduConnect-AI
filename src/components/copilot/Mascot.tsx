import React from 'react';

/** Simple replaceable SVG placeholder — no external avatar / generated face. */
export function EduConnectMascot({ className = 'w-10 h-10' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      role="img"
      aria-label="EduConnect assistant"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="4" y="8" width="56" height="48" rx="12" fill="var(--brand-primary)" opacity="0.15" />
      <circle cx="32" cy="28" r="14" fill="var(--brand-primary)" />
      <circle cx="26" cy="26" r="2.5" fill="var(--bg-card)" />
      <circle cx="38" cy="26" r="2.5" fill="var(--bg-card)" />
      <path d="M24 34c3 3 13 3 16 0" stroke="var(--bg-card)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <rect x="18" y="44" width="28" height="8" rx="3" fill="var(--brand-accent)" opacity="0.85" />
    </svg>
  );
}
