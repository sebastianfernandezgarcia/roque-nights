/**
 * A whole observing plan inside a link.
 *
 * The plan travels in the URL fragment, which the browser never sends to a
 * server: there is no backend here, and a shared plan must not need one. The
 * payload is base64url of the UTF-8 JSON, built with TextEncoder and btoa so the
 * same code runs in the browser and in vitest without Node's Buffer.
 *
 * Nothing in this module throws. A hash that is truncated, mangled by a chat
 * client or simply not ours decodes to null, and the caller says so in words.
 */

import { parseObservingPlanV1, type ObservingPlanV1 } from './serialize'

/** Where the app is published; used when there is no `location` to ask. */
export const APP_ORIGIN = 'https://roque-nights.netlify.app'

export const PLAN_HASH_PREFIX = '#plan='

/** Longer than this and chat clients start truncating the link. */
export const SHARE_URL_WARN_LENGTH = 2000

const BASE64URL_ONLY = /^[A-Za-z0-9_-]+$/
/** `#plan=...`, `?plan=...` or `&plan=...`, up to the next parameter. */
const PLAN_PARAM = /[#?&]plan=([^&\s]*)/

function encodeUtf8Base64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  // Chunked so a long plan cannot blow the argument limit of String.fromCharCode.
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decodeBase64UrlUtf8(payload: string): string | null {
  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  try {
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

/** The whole plan as a URL fragment: `#plan=<base64url of the JSON>`. */
export function encodePlanToHash(plan: ObservingPlanV1): string {
  return `${PLAN_HASH_PREFIX}${encodeUtf8Base64Url(JSON.stringify(plan))}`
}

/**
 * Read a plan out of a share URL, a bare `#plan=...` fragment or the raw
 * payload. Returns null for anything that is not a readable v1 plan; it never
 * throws, because the input is whatever someone pasted into a chat.
 */
export function decodePlanFromHash(hash: string): ObservingPlanV1 | null {
  if (typeof hash !== 'string') return null
  const trimmed = hash.trim()
  if (trimmed === '') return null

  const match = PLAN_PARAM.exec(trimmed)
  let payload = match ? match[1] : trimmed.replace(/^#/, '')
  if (payload === '') return null

  if (payload.includes('%')) {
    try {
      payload = decodeURIComponent(payload)
    } catch {
      return null
    }
  }
  if (!BASE64URL_ONLY.test(payload)) return null

  const json = decodeBase64UrlUtf8(payload)
  if (json === null) return null

  const parsed = parseObservingPlanV1(json)
  return 'plan' in parsed ? parsed.plan : null
}

function defaultOrigin(): string {
  if (typeof location !== 'undefined' && typeof location.origin === 'string' && location.origin) {
    return location.origin
  }
  return APP_ORIGIN
}

/** `https://origin/#plan=...`, ready to paste into a message. */
export function buildShareUrl(plan: ObservingPlanV1, origin?: string): string {
  const base = (origin && origin.trim() !== '' ? origin.trim() : defaultOrigin()).replace(/\/+$/, '')
  return `${base}/${encodePlanToHash(plan)}`
}
