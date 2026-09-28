/**
 * Marks a value the system models rather than measures.
 *
 * On the soil-moisture board there are no voltage or current sensors: solar
 * power comes from an irradiance model and battery % from an energy balance.
 * Presenting those identically to a measured reading would overstate what
 * the hardware actually knows, so they carry this badge and a tooltip
 * explaining the derivation.
 */
export function EstimatedBadge({ title }) {
  return (
    <span
      title={title || 'Modelled value, not measured by a sensor'}
      className="cursor-help rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-text-3"
    >
      Est.
    </span>
  );
}
