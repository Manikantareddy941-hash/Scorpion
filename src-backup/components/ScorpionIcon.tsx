<<<<<<< HEAD
export default function ScorpionIcon({ size = 32, color = "#E8440A" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Body */}
      <ellipse cx="50" cy="55" rx="12" ry="18" fill={color} />
      {/* Head */}
      <circle cx="50" cy="32" r="9" fill={color} />
      {/* Tail segments */}
      <path d="M58 50 Q70 45 75 35 Q80 25 90 20" stroke={color} strokeWidth="5" strokeLinecap="round" fill="none"/>
      {/* Stinger */}
      <path d="M90 20 L97 12" stroke={color} strokeWidth="4" strokeLinecap="round"/>
      {/* Left claw */}
      <path d="M44 38 Q30 30 22 35 M22 35 L15 28 M22 35 L16 40" stroke={color} strokeWidth="3.5" strokeLinecap="round" fill="none"/>
      {/* Right claw */}
      <path d="M56 38 Q70 30 78 35 M78 35 L85 28 M78 35 L84 40" stroke={color} strokeWidth="3.5" strokeLinecap="round" fill="none"/>
      {/* Legs */}
      <path d="M42 52 L28 46 M42 58 L26 55 M58 52 L72 46 M58 58 L74 55" stroke={color} strokeWidth="2.5" strokeLinecap="round"/>
    </svg>
=======
export default function ScorpionIcon({ size = 32 }: { size?: number; color?: string }) {
  return (
    <img
      src="/src/assets/scorpio-logo.jpg"
      alt="SCORPION"
      style={{ width: size, height: size, objectFit: 'contain' }}
    />
>>>>>>> 98f3544 (ui updates)
  );
}
