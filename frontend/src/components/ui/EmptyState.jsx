/**
 * Garden-themed empty/loading state. The seedling is a "things are healthy"
 * signal, so it wears the good-status green rather than the brand red, and
 * it only breathes when an ancestor carries `is-loading`.
 */
function Sprout({ className = '' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--status-good)"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`sprout ${className}`}
    >
      <path d="M12 21V10" />
      <path d="M12 14C12 10 9.5 6.5 5.5 6.5 5.5 10.5 8 14 12 14Z" />
      <path d="M12 12.5C12 9.5 14.5 6.5 18.5 6.5 18.5 10 16 12.5 12 12.5Z" />
      <path d="M6.5 21h11" />
    </svg>
  );
}

export function EmptyState({ icon: Icon, title = 'No data yet', message = 'Waiting for sensor readings...' }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      {Icon ? (
        <Icon className="h-10 w-10 text-status-good" strokeWidth={1.5} aria-hidden="true" />
      ) : (
        <Sprout className="h-10 w-10" />
      )}
      <h3 className="mt-4 text-[13px] font-medium text-text-2">{title}</h3>
      {message && <p className="mt-1 max-w-xs text-xs text-text-3">{message}</p>}
    </div>
  );
}
