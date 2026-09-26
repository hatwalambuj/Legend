import { describe, expect, it } from 'vitest';
import { CircuitBreaker, CircuitOpenError } from './circuit-breaker';

describe('CircuitBreaker', () => {
  it('opens after 5 failures in 30 s, half-opens after 60 s, closes on success', async () => {
    let now = 0;
    const b = new CircuitBreaker({}, () => now);
    const fail = () =>
      b
        .run(async () => {
          throw new Error('down');
        })
        .catch((e: Error) => e);
    for (let i = 0; i < 4; i++) await fail();
    expect(b.state()).toBe('closed');
    await fail();
    expect(b.state()).toBe('open');
    expect(await fail()).toBeInstanceOf(CircuitOpenError);
    now += 60_000;
    expect(b.state()).toBe('half_open');
    expect(await b.run(async () => 'ok')).toBe('ok');
    expect(b.state()).toBe('closed');
  });

  it('a failed trial re-opens; failures outside the window do not add up; non-failures are ignored', async () => {
    let now = 0;
    const b = new CircuitBreaker({ threshold: 2, windowMs: 1000, openMs: 500 }, () => now);
    const boom = async () => {
      throw new Error('x');
    };
    await b.run(boom).catch(() => {});
    now += 2000;
    await b.run(boom).catch(() => {});
    expect(b.state()).toBe('closed');
    await b.run(boom).catch(() => {});
    expect(b.state()).toBe('open');
    now += 500;
    await b.run(boom).catch(() => {});
    expect(b.state()).toBe('open');
    now += 500;
    await b.run(boom, () => false).catch(() => {}); // e.g. a 404: an answer, not an outage
    expect(b.state()).toBe('closed');
  });
});
