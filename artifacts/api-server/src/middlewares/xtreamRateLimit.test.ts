import assert from "node:assert/strict";
import type { Request, Response } from "express";
import app from "../app";
import { xtreamRateLimit } from "./xtreamRateLimit";

function request(forwardedIp: string): Request {
  const req = Object.create(app.request) as Request;
  req.headers = { "x-forwarded-for": forwardedIp };
  Object.defineProperty(req, "socket", { value: { remoteAddress: "192.0.2.10" } });
  return req;
}

function invoke(req: Request): number {
  let statusCode = 200;
  let nextCalled = false;
  const res = {
    setHeader() { return this; },
    status(code: number) { statusCode = code; return this; },
    json() { return this; },
  } as unknown as Response;
  xtreamRateLimit(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, statusCode === 200);
  return statusCode;
}

assert.equal(app.get("trust proxy"), Number(process.env.TRUST_PROXY_HOPS ?? "1"));
assert.equal(app.enabled("x-powered-by"), false);
process.stdout.write("PASS [api-proxy] proxy settings are explicit\n");

// The same socket belongs to the trusted reverse proxy, but client IPs differ.
const first = request("198.51.100.21");
const second = request("198.51.100.22");
assert.equal(first.ip, "198.51.100.21");
assert.equal(second.ip, "198.51.100.22");
for (let i = 0; i < 60; i++) assert.equal(invoke(first), 200);
assert.equal(invoke(first), 429);
assert.equal(invoke(second), 200);
process.stdout.write("PASS [api-proxy] Xtream limiter keys distinct clients by req.ip\n");
process.stdout.write("API trust proxy rate limit scenarios: 2/2 passed\n");
