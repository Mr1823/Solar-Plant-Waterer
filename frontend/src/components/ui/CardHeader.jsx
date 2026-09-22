/**
 * Shared card/section header: icon + title on the left, one control
 * (status badge, button, range picker) right-aligned.
 */
export function CardHeader({
  icon: Icon,
  title,
  subtitle,
  iconClass = 'text-text-2',
  children,
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <Icon className={`h-4 w-4 shrink-0 ${iconClass}`} strokeWidth={1.75} />
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-text-1">{title}</h2>
          {subtitle && <p className="label-micro truncate">{subtitle}</p>}
        </div>
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </div>
  );
}
