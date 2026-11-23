/** Expand one publication batch without coalescing ordered trade/transition events. */
export function bookmapEvents(wire: unknown): Record<string, any>[] {
  if (!wire || typeof wire !== 'object' || Array.isArray(wire)) throw new Error('Invalid Bookmap message');
  const value = wire as Record<string, any>;
  if (value.type !== 'cairo_batch') return [value];
  if (value.version !== 1 || !Array.isArray(value.events) || value.events.some((event: unknown) =>
    !event || typeof event !== 'object' || Array.isArray(event) || typeof (event as any).type !== 'string' || (event as any).type === 'cairo_batch'))
    throw new Error('Invalid Bookmap batch');
  return value.events;
}
