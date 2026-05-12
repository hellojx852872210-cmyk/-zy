import crypto from "node:crypto";
import { config } from "./config.js";

const sessions = new Map();

function now() {
  return Date.now();
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return header.split(";").reduce((acc, part) => {
    const [k, ...rest] = part.trim().split("=");
    if (!k) return acc;
    acc[k] = decodeURIComponent(rest.join("=") || "");
    return acc;
  }, {});
}

function cookieParts(value, maxAgeMs = config.sessionTtlMs) {
  const maxAge = Math.max(0, Math.floor(maxAgeMs / 1000));
  return [
    `${config.sessionCookieName}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`
  ];
}

export function createSession(user) {
  const sid = crypto.randomBytes(24).toString("hex");
  sessions.set(sid, {
    user,
    expiresAt: now() + config.sessionTtlMs
  });
  return sid;
}

export function getSessionUser(req) {
  const cookies = parseCookies(req);
  const sid = cookies[config.sessionCookieName];
  if (!sid) return null;
  const session = sessions.get(sid);
  if (!session) return null;
  if (session.expiresAt <= now()) {
    sessions.delete(sid);
    return null;
  }
  session.expiresAt = now() + config.sessionTtlMs;
  return { sid, user: session.user };
}

export function clearSession(req) {
  const cookies = parseCookies(req);
  const sid = cookies[config.sessionCookieName];
  if (sid) sessions.delete(sid);
}

export function setSessionCookie(res, sid) {
  res.setHeader("Set-Cookie", cookieParts(sid).join("; "));
}

export function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", cookieParts("", 0).join("; "));
}
