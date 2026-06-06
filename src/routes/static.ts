import { Hono } from 'hono'
import type { AppEnv } from '../types'
// @ts-ignore - Wrangler injects this module for Workers Sites
import manifestJSON from '__STATIC_CONTENT_MANIFEST'

const staticAssets = new Hono<AppEnv>()

// Parse manifest once at module level
let manifest: Record<string, string> = {}
try {
  manifest = JSON.parse(manifestJSON)
} catch {
  manifest = {}
}

// MIME types map
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
}

function getContentType(path: string): string {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase()
  return MIME_TYPES[ext] || 'application/octet-stream'
}

function isHashedAsset(path: string): boolean {
  return /[-.][\da-f]{8,}\./i.test(path)
}

/**
 * Serve CMS static assets từ __STATIC_CONTENT KV namespace.
 * SPA fallback: mọi route không match asset → trả index.html.
 */
staticAssets.get('/*', async (c) => {
  const kv = c.env.__STATIC_CONTENT
  if (!kv) {
    return c.text('CMS not available', 404)
  }

  // c.req.path includes /cms prefix (Hono .route() doesn't strip it).
  // Bucket = ./dist nên KV key có prefix cms/...
  // /cms/ → cms/index.html, /cms/login → cms/login, /cms/assets/index.js → cms/assets/index.js
  let relativePath = c.req.path.replace(/^\/cms\/?/, '')
  if (!relativePath) relativePath = 'index.html'
  const assetPath = `cms/${relativePath}`

  // Lookup in manifest (maps original filename → hashed filename in KV)
  const kvKey = manifest[assetPath] || assetPath

  // Try to get asset from KV
  let asset = await kv.get(kvKey, 'arrayBuffer')

  // If not found → SPA fallback: serve index.html
  if (!asset) {
    const indexKey = manifest['cms/index.html'] || 'cms/index.html'
    asset = await kv.get(indexKey, 'arrayBuffer')

    if (!asset) {
      return c.html(
        '<html><body><h1>CMS Not Found</h1><p>Build CMS first: <code>npm run build:cms</code></p></body></html>',
        404
      )
    }

    return new Response(asset, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
    })
  }

  // Asset found → serve with cache headers
  const contentType = getContentType(assetPath)
  const cacheControl = isHashedAsset(kvKey)
    ? 'public, max-age=31536000, immutable'
    : contentType.includes('text/html')
      ? 'no-cache'
      : 'public, max-age=3600'

  return new Response(asset, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': cacheControl,
    },
  })
})

export { staticAssets }
