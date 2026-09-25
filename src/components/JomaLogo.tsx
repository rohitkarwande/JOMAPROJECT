import React from 'react';

interface JomaLogoProps {
  height?: number;
  className?: string;
}

export const JomaLogo: React.FC<JomaLogoProps> = ({ height = 32, className = '' }) => {
  const width = Math.round(height * (500 / 180));
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 500 180"
      style={{ height: `${height}px`, width: `${width}px`, display: 'block' }}
      className={className}
    >
      {/* JOMA Blue Text */}
      <g fill="#028bda">
        <path d="M 15 20 H 60 V 105 C 60 125 45 138 25 138 C 15 138 5 133 0 128 L 8 100 C 12 104 18 107 24 107 C 30 107 35 102 35 94 V 20 Z" />
        <path d="M 125 18 C 158 18 178 45 178 78 C 178 112 158 138 125 138 C 92 138 72 112 72 78 C 72 45 92 18 125 18 Z M 125 46 C 111 46 100 60 100 78 C 100 96 111 110 125 110 C 139 110 150 96 150 78 C 150 60 139 46 125 46 Z" />
        <path d="M 190 20 H 222 L 245 78 L 268 20 H 300 V 138 H 274 V 62 L 253 115 H 237 L 216 62 V 138 H 190 Z" />
        <path d="M 345 20 H 378 L 420 138 H 389 L 381 110 H 342 L 334 138 H 303 Z M 374 86 L 361 44 L 348 86 Z" />
      </g>

      {/* Orange Lightning Bolt through O */}
      <polygon points="135,-5 160,-5 125,65 148,65 95,160 115,90 92,90" fill="#f59e0b" stroke="#ffffff" strokeWidth="3" />

      {/* Underlines */}
      <rect x="0" y="152" width="215" height="5" fill="#f59e0b" />
      <rect x="0" y="164" width="215" height="6" fill="#028bda" />

      {/* Next Gen Power Italic Text */}
      <text x="222" y="167" fontFamily="'Segoe UI', 'Helvetica', sans-serif" fontWeight="700" fontStyle="italic" fontSize="34" fill="#475569">
        Next Gen Power
      </text>
    </svg>
  );
};
