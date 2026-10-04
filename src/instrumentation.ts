/**
 * Next instrumentation hook (ADR-013 C-13): server errors become one redacted `request_error` JSON line
 * in our own logs. Only the route file path, route type, digest and message are logged — never the URL
 * query, headers or body. No third party. OWNER: Backend.
 */
import type { Instrumentation } from 'next';
import { log } from './server/log';

export const onRequestError: Instrumentation.onRequestError = async (err, _request, context) => {
  const message = err instanceof Error ? err.message : String(err);
  const digest =
    typeof err === 'object' && err !== null && 'digest' in err
      ? String((err as { digest?: unknown }).digest)
      : undefined;
  log.error('request_error', {
    routePath: context.routePath,
    routeType: context.routeType,
    ...(digest ? { digest: digest.slice(0, 64) } : {}),
    message: message.slice(0, 300),
  });
  // AR-C2: Hobby keeps logs ~1 h, so also count it (`server_error`, route type + first route segment).
  // Node only: the counter needs the data container, which the edge runtime does not load.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  try {
    const { recordServerError } = await import('./server/events');
    recordServerError(context.routeType, context.routePath);
  } catch (e) {
    log.warn('events_write_failed', { error: e });
  }
};
