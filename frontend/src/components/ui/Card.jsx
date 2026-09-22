export function Card({ children, className = '', glow = '' }) {
  return (
    <div className={`card ${glow} ${className}`}>
      {children}
    </div>
  );
}
