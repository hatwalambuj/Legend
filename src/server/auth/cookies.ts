/**
 * Cookie access behind a tiny interface so auth providers are unit-testable without a request scope.
 * All auth cookies are httpOnly + SameSite=Lax + path=/; `Secure` follows the request scheme
 * (x-forwarded-proto, else NEXT_PUBLIC_SITE_URL), so demo mode also works over plain http://127.0.0.1.
 * OWNER: Backend.
 */
import { cookies, headers } from 'next/headers';
import { env } from '@/server/env';

export interface CookieJar {
  get(name: string): string | undefined;
  set(name: string, value: string, opts: { maxAge: number }): void;
  delete(name: string): void;
}

export function isSecureRequest(h: Pick<Headers, 'get'>, siteUrl: string): boolean {
  const proto = h.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  if (proto) return proto === 'https';
  return siteUrl.startsWith('https://');
}

export async function requestCookieJar(): Promise<CookieJar> {
  const jar = await cookies();
  const secure = isSecureRequest(await headers(), env().siteUrl);
  return {
    get: (name) => jar.get(name)?.value,
    set: (name, value, { maxAge }) =>
      jar.set(name, value, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge }),
    delete: (name) =>
      jar.set(name, '', { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 0 }),
  };
}

/** In-memory jar for tests. */
export function memoryCookieJar(initial: Record<string, string> = {}): CookieJar & {
  values: Map<string, string>;
} {
  const values = new Map(Object.entries(initial));
  return {
    values,
    get: (n) => values.get(n),
    set: (n, v, { maxAge }) => (maxAge > 0 ? values.set(n, v) : values.delete(n)),
    delete: (n) => values.delete(n),
  };
}
