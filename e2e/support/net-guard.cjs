/**
 * QA net guard (preloaded with NODE_OPTIONS="--require ./e2e/support/net-guard.cjs").
 * Records every outbound TCP connect and DNS lookup made by the server process to a non-loopback host,
 * so e2e/platform.spec.ts can assert that demo mode makes zero outbound requests (ADR-006 §4).
 * It only observes; it never blocks. Inert unless E2E_NET_LOG is set.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const dns = require('node:dns');

const file = process.env.E2E_NET_LOG;
if (file) {
  const abs = path.resolve(file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const who = { pid: process.pid, argv: process.argv.slice(1, 3).join(' ') };
  const write = (o) => {
    try {
      fs.appendFileSync(abs, `${JSON.stringify({ ...o, ...who, at: new Date().toISOString() })}\n`);
    } catch {
      /* never break the server */
    }
  };
  // The first process in the tree truncates the log; children (inheriting NODE_OPTIONS) append.
  if (!process.env.E2E_NET_GUARD_ARMED) {
    process.env.E2E_NET_GUARD_ARMED = '1';
    fs.writeFileSync(abs, '');
  }
  write({ kind: 'armed' });

  const LOCAL = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', '::', '::ffff:127.0.0.1']);
  const isLocal = (h) => h === undefined || h === null || h === '' || LOCAL.has(String(h));

  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    let o = args[0];
    if (Array.isArray(o)) o = o[0];
    if (o && typeof o === 'object') {
      if (!o.path && !isLocal(o.host)) write({ kind: 'connect', host: o.host, port: o.port });
    } else if (typeof o === 'number' || (typeof o === 'string' && /^\d+$/.test(o))) {
      if (typeof args[1] === 'string' && !isLocal(args[1]))
        write({ kind: 'connect', host: args[1], port: o });
    }
    return connect.apply(this, args);
  };

  const lookup = dns.lookup;
  dns.lookup = function (host, ...rest) {
    if (!isLocal(host)) write({ kind: 'dns', host });
    return lookup.call(this, host, ...rest);
  };
  const plookup = dns.promises.lookup;
  dns.promises.lookup = function (host, ...rest) {
    if (!isLocal(host)) write({ kind: 'dns', host });
    return plookup.call(this, host, ...rest);
  };
}
