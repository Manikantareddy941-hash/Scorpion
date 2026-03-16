export default function ScorpionIcon({ size = 32 }: { size?: number; color?: string }) {
  return (
    <img
      src="/src/assets/scorpio-logo.jpg"
      alt="SCORPION"
      style={{ width: size, height: size, objectFit: 'contain' }}
    />
  );
}
