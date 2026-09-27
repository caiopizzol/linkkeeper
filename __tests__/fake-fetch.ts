/**
 * Preloaded into the CLI under test so it never reaches the network.
 *
 * Every request is written to the log before it is answered. Only a request
 * whose method and URL match a declared route gets that route's response.
 * Anything else gets the 404 that GitHub returns for a path that does not
 * exist. An authorization value is never written to the log.
 */
import { appendFileSync, readFileSync } from 'node:fs';

export interface Recorded {
  method: string;
  url: string;
  redirect: RequestRedirect;
  headers: Record<string, string>;
}

/** Responses keyed by `${method} ${url}`. */
export type Routes = Record<string, { status: number; body: string }>;

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const routes = JSON.parse(readFileSync(env('LINKKEEPER_FAKE_ROUTES'), 'utf8')) as Routes;
const log = env('LINKKEEPER_FAKE_LOG');

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input, init);
  const headers = Object.fromEntries(request.headers);
  if (headers.authorization !== undefined) headers.authorization = '[redacted]';

  const recorded: Recorded = { method: request.method, url: request.url, redirect: request.redirect, headers };
  appendFileSync(log, `${JSON.stringify(recorded)}\n`);

  const route = routes[`${request.method} ${request.url}`] ?? { status: 404, body: 'Not Found' };
  return new Response(route.body, { status: route.status });
}) as typeof fetch;
