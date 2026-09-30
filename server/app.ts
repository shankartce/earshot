// HTTP side of the production server: static client + SPA routes + realtime. There is deliberately
// no upload endpoint and no body parser — audio never reaches this server.
import express from 'express'
import http from 'node:http'
import path from 'node:path'
import type { RoomStore } from './rooms/store.ts'
import { attachRealtime } from './websocket/handlers.ts'

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", // inline style attributes drive CSS variables
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' blob: data:", // artwork thumbnails are local blob: URLs
  "media-src 'self' blob:", // audio plays from local blob: URLs
  "worker-src 'self' blob:",
  "connect-src 'self' ws: wss:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ')

export function createServer({ store, dist, graceMs }: { store: RoomStore; dist: string; graceMs?: number }) {
  const app = express()
  app.disable('x-powered-by')
  app.use((_req, res, next) => {
    res.set({
      'Content-Security-Policy': CSP,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
      'Cross-Origin-Opener-Policy': 'same-origin',
    })
    next()
  })
  app.use(express.static(dist, { index: false, maxAge: '1h' }))
  // Only GET/HEAD are served; anything else (e.g. an attempted upload) is a 404.
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(dist, 'index.html'), err => { if (err) res.status(404).end() }))
  app.use((_req, res) => res.status(404).end())

  const server = http.createServer(app)
  attachRealtime(server, { store, graceMs })
  return server
}
