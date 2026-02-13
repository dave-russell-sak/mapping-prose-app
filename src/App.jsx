import { useState, useCallback, useEffect, useRef } from 'react'
import { Copy, Check, MapPin, Loader2, RotateCcw } from 'lucide-react'
import { AddressSearch } from './components/AddressSearch'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN
const DIRECTIONS_URL = 'https://api.mapbox.com/directions/v5/mapbox/driving'
const GEOCODE_URL = 'https://api.mapbox.com/search/geocode/v6/forward'
const DEFAULT_ORIGIN = '55 W. Church St., Orlando, FL 32801'

const MAP_LINK_SPACER = '\u00A0'.repeat(8)
const APP_VERSION = '1.3.0' // Bump after deploy to verify latest (e.g. in footer)

function RedPinIcon({ className = 'h-4 w-4' }) {
  return (
    <span className={`inline-block shrink-0 text-red-600 ${className}`} aria-hidden>
      <svg viewBox="0 0 24 36" fill="currentColor" className="w-full h-full">
        <path d="M12 0C5.373 0 0 5.373 0 12c0 9 12 24 12 24s12-15 12-24C24 5.373 18.627 0 12 0zm0 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10z" />
      </svg>
    </span>
  )
}

function parseCoordsFromInput(input) {
  const s = input.trim()
  if (!s) return null

  const googleMatch = s.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/) ||
    s.match(/\/dir\/\/\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/) ||
    s.match(/[?&](?:q|query)=(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/)
  if (googleMatch) {
    const a = parseFloat(googleMatch[1])
    const b = parseFloat(googleMatch[2])
    const lat = Math.abs(a) <= 90 ? a : b
    const lng = Math.abs(b) <= 180 ? b : a
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return [lng, lat]
  }

  const twoNumbers = s.match(/^(-?\d+\.?\d*)\s*[,]\s*(-?\d+\.?\d*)\s*$/)
  if (twoNumbers) {
    const a = parseFloat(twoNumbers[1])
    const b = parseFloat(twoNumbers[2])
    const lat = Math.abs(a) <= 90 ? a : b
    const lng = Math.abs(b) <= 180 ? b : a
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return [lng, lat]
  }

  return null
}

async function resolveSelfParkingInput(input, token) {
  if (!input?.trim()) return null
  const coords = parseCoordsFromInput(input)
  if (coords) {
    return { label: `Self-parking (${coords[1].toFixed(5)}, ${coords[0].toFixed(5)})`, coordinates: coords }
  }
  const result = await geocodeAddress(input.trim(), token, 'US')
  return result ? { ...result, label: result.label || 'Self-parking' } : null
}

async function geocodeAddress(address, token, countryCode = 'US') {
  const params = new URLSearchParams({
    q: address,
    access_token: token,
    limit: '1',
    autocomplete: 'false',
  })
  if (countryCode) params.set('country', countryCode)
  const res = await fetch(`${GEOCODE_URL}?${params.toString()}`)
  const data = await res.json()
  const feature = data.features?.[0]
  if (!feature?.geometry?.coordinates) return null
  const props = feature.properties || {}
  const name = props.name || props.address_line1 || ''
  const place = props.place_formatted || ''
  const label = props.full_address || (name && place ? `${name}, ${place}` : name || place)
  return { label: label || address, coordinates: feature.geometry.coordinates }
}

async function fetchRoute(origin, destination) {
  const coords = `${origin[0]},${origin[1]};${destination[0]},${destination[1]}`
  const url = `${DIRECTIONS_URL}/${coords}?access_token=${MAPBOX_TOKEN}&steps=true&overview=simplified`
  const res = await fetch(url)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Directions API error: ${res.status}`)
  }
  return res.json()
}

function extractManeuvers(data) {
  const maneuvers = []
  const route = data.routes?.[0]
  if (!route?.legs) return maneuvers

  for (const leg of route.legs) {
    const steps = leg.steps || []
    for (const step of steps) {
      const inst = step.maneuver?.instruction
      if (inst) maneuvers.push(inst)
    }
  }
  return maneuvers
}

export default function App() {
  const [origin, setOrigin] = useState({ label: DEFAULT_ORIGIN })
  const [destination, setDestination] = useState(null)
  const [originGeocoding, setOriginGeocoding] = useState(true)
  const [includeInternational, setIncludeInternational] = useState(false)
  const [selfParkingOverride, setSelfParkingOverride] = useState('')
  const [effectiveDestination, setEffectiveDestination] = useState(null)
  const copyBlockRef = useRef(null)

  useEffect(() => {
    if (!MAPBOX_TOKEN) {
      setOriginGeocoding(false)
      return
    }
    geocodeAddress(DEFAULT_ORIGIN, MAPBOX_TOKEN, 'US').then((result) => {
      if (result) setOrigin(result)
      setOriginGeocoding(false)
    })
  }, [])
  const [prose, setProse] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)
  const [linksCopied, setLinksCopied] = useState(false)
  const linksCopyBlockRef = useRef(null)

  const handleOriginChange = useCallback((value) => {
    setOrigin(value)
    if (value === null) setOriginGeocoding(false)
    setError(null)
  }, [])

  const handleDestinationChange = useCallback((value) => {
    setDestination(value)
    setError(null)
  }, [])

  const handleGenerate = async () => {
    if (!origin?.coordinates || !destination?.coordinates) {
      setError('Please select both a starting point and destination from the suggestions.')
      return
    }

    setIsGenerating(true)
    setError(null)
    setProse('')
    setEffectiveDestination(null)

    try {
      let routingDestination = destination
      if (selfParkingOverride.trim() && MAPBOX_TOKEN) {
        const resolved = await resolveSelfParkingInput(selfParkingOverride.trim(), MAPBOX_TOKEN)
        if (resolved) routingDestination = resolved
      }
      setEffectiveDestination(routingDestination)

      const directions = await fetchRoute(origin.coordinates, routingDestination.coordinates)
      const maneuvers = extractManeuvers(directions)

      if (maneuvers.length === 0) {
        throw new Error('No route found between these locations.')
      }

      const res = await fetch('/api/generate-prose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maneuvers }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to generate narrative')
      setProse(data.prose)
    } catch (err) {
      setError(err.message || 'Something went wrong.')
    } finally {
      setIsGenerating(false)
    }
  }

  const effective = effectiveDestination || destination
  const effectiveCoords = effective?.coordinates
  const destinationAddress = effective?.label || ''
  const googleMapsUrl = effectiveCoords
    ? `https://www.google.com/maps/dir/?api=1&destination=${effectiveCoords[1]},${effectiveCoords[0]}`
    : destinationAddress
      ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destinationAddress)}`
      : ''
  // Use https so the link is clickable on mobile (maps:// is often blocked in browsers)
  const appleMapsUrl = effectiveCoords
    ? `https://maps.apple.com/?daddr=${effectiveCoords[1]},${effectiveCoords[0]}`
    : destinationAddress
      ? `https://maps.apple.com/?daddr=${encodeURIComponent(destinationAddress)}`
      : ''

  const getCopyText = () => prose || ''

  const getLinksCopyText = () => {
    const lines = []
    if (googleMapsUrl) lines.push(`Open in Google Maps: ${googleMapsUrl}`)
    if (appleMapsUrl) lines.push(`Open in Apple Maps: ${appleMapsUrl}`)
    return lines.join('\n')
  }

  const handleCopyLinks = async () => {
    if (!googleMapsUrl && !appleMapsUrl) return
    // Prefer Clipboard API with minimal HTML (no block wrapper) to avoid Word adding a text box
    const pinSvg = '<span style="color:#dc2626;display:inline-block;vertical-align:middle;width:1em;height:1.5em;"><svg viewBox="0 0 24 36" fill="currentColor" style="width:100%;height:100%"><path d="M12 0C5.373 0 0 5.373 0 12c0 9 12 24 12 24s12-15 12-24C24 5.373 18.627 0 12 0zm0 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10z"/></svg></span>'
    // Paste = pin + [Open in Google Maps] only (no URL text), so Word gets just linkable text
    const line1 = googleMapsUrl
      ? `${pinSvg} [<a href="${googleMapsUrl}" style="border:none;outline:none;">Open in Google Maps</a>]`
      : ''
    const line2 = appleMapsUrl
      ? `${pinSvg} [<a href="${appleMapsUrl}" style="border:none;outline:none;">Open in Apple Maps</a>]`
      : ''
    const html = [
      '<span style="font-family:Arial;font-size:10pt;margin:0;padding:0;border:none;">',
      line1,
      line1 && line2 ? '<br>' : '',
      line2,
      '</span>',
    ].join('')
    const text = getLinksCopyText()
    if (navigator.clipboard?.write) {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([text], { type: 'text/plain' }),
          }),
        ])
        setLinksCopied(true)
        setTimeout(() => setLinksCopied(false), 2000)
        return
      } catch {
        // fall through to execCommand path
      }
    }
    const block = linksCopyBlockRef.current
    if (block && window.getSelection && document.createRange) {
      const selection = window.getSelection()
      const range = document.createRange()
      selection.removeAllRanges()
      range.selectNodeContents(block)
      selection.addRange(range)
      try {
        const ok = document.execCommand('copy')
        selection.removeAllRanges()
        if (ok) {
          setLinksCopied(true)
          setTimeout(() => setLinksCopied(false), 2000)
          return
        }
      } catch {
        selection.removeAllRanges()
      }
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        throw new Error('Clipboard not available')
      }
      setLinksCopied(true)
      setTimeout(() => setLinksCopied(false), 2000)
    } catch {
      const textArea = document.createElement('textarea')
      textArea.value = text
      textArea.style.position = 'fixed'
      textArea.style.left = '-9999px'
      document.body.appendChild(textArea)
      textArea.select()
      try {
        document.execCommand('copy')
        setLinksCopied(true)
        setTimeout(() => setLinksCopied(false), 2000)
      } finally {
        document.body.removeChild(textArea)
      }
    }
  }

  const handleCopy = async () => {
    if (!prose) return

    // Copy only the narrative block (for paste-and-match-formatting in Word)
    const block = copyBlockRef.current
    if (block && window.getSelection && document.createRange) {
      const selection = window.getSelection()
      const range = document.createRange()
      selection.removeAllRanges()
      range.selectNodeContents(block)
      selection.addRange(range)
      try {
        const ok = document.execCommand('copy')
        selection.removeAllRanges()
        if (ok) {
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
          setError(null)
          return
        }
      } catch {
        selection.removeAllRanges()
        // fall through to plain-text copy
      }
    }

    // Fallback: plain-text copy of narrative only
    const text = getCopyText()
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        throw new Error('Clipboard not available')
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      setError(null)
    } catch {
      const textArea = document.createElement('textarea')
      textArea.value = text
      textArea.style.position = 'fixed'
      textArea.style.left = '-9999px'
      textArea.setAttribute('readonly', '')
      document.body.appendChild(textArea)
      textArea.select()
      try {
        document.execCommand('copy')
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
        setError(null)
      } catch {
        setError('Could not copy to clipboard.')
      }
      document.body.removeChild(textArea)
    }
  }

  const handleReset = () => {
    setDestination(null)
    setSelfParkingOverride('')
    setEffectiveDestination(null)
    setProse('')
    setError(null)
    setOrigin({ label: DEFAULT_ORIGIN })
    setOriginGeocoding(true)
    geocodeAddress(DEFAULT_ORIGIN, MAPBOX_TOKEN, 'US').then((result) => {
      if (result) setOrigin(result)
      setOriginGeocoding(false)
    })
  }

  const canGenerate = origin?.coordinates && destination?.coordinates && !isGenerating

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-amber-50/30">
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 lg:px-8">
        <header className="mb-10 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Narrative Directions
          </h1>
          <p className="mt-2 text-slate-600">
            Turn-by-turn directions narrative
          </p>
          <p className="mt-1 text-xs text-slate-400" title="Bump this after deploy to verify you're on the latest">
            v{APP_VERSION}
          </p>
        </header>

        <div className="space-y-6">
          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
            <input
              type="checkbox"
              checked={includeInternational}
              onChange={(e) => setIncludeInternational(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-amber-500 focus:ring-amber-500"
            />
            <span className="text-sm text-slate-700">
              Travel is outside the contiguous US (show international addresses)
            </span>
          </label>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Starting Point
            </label>
            <AddressSearch
              value={origin?.label}
              onChange={handleOriginChange}
              placeholder="Enter an address..."
              mapboxToken={MAPBOX_TOKEN}
              confirmed={!!origin?.coordinates || originGeocoding}
              restrictToUS={!includeInternational}
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Destination
            </label>
            <AddressSearch
              value={destination?.label}
              onChange={handleDestinationChange}
              placeholder="Enter an address..."
              mapboxToken={MAPBOX_TOKEN}
              confirmed={!!destination?.coordinates}
              restrictToUS={!includeInternational}
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Self-parking (optional)
            </label>
            <input
              type="text"
              value={selfParkingOverride}
              onChange={(e) => setSelfParkingOverride(e.target.value)}
              placeholder="Paste a Google Maps link, or enter coordinates (lat,lng) or address"
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 placeholder-slate-400 shadow-sm transition focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
            />
            <p className="mt-1 text-xs text-slate-500">
              Routes and map links will go here instead of the destination above. Leave blank to use the destination.
            </p>
          </div>

          <button
            onClick={handleGenerate}
            disabled={!canGenerate}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-6 py-4 font-semibold text-white shadow-lg transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-amber-500"
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <MapPin className="h-5 w-5" />
                Generate Narrative
              </>
            )}
          </button>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          )}

          {prose && (
            <div className="rounded-2xl border border-slate-200 bg-white/80 p-6 shadow-sm backdrop-blur-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-800">Your Narrative</h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopy}
                    className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                    title="Copy narrative to clipboard"
                  >
                    {copied ? (
                      <>
                        <Check className="h-4 w-4 text-emerald-600" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4" />
                        Copy
                      </>
                    )}
                  </button>
                  {destinationAddress && (googleMapsUrl || appleMapsUrl) && (
                    <button
                      onClick={handleCopyLinks}
                      className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                      title="Copy map links to clipboard"
                    >
                      {linksCopied ? (
                        <>
                          <Check className="h-4 w-4 text-emerald-600" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="h-4 w-4" />
                          Copy links
                        </>
                      )}
                    </button>
                  )}
                  <button
                    onClick={handleReset}
                    className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                    title="Reset and generate another"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Reset
                  </button>
                </div>
              </div>
              {selfParkingOverride.trim() && effectiveDestination && effectiveDestination !== destination && (
                <p className="mb-3 text-sm text-slate-600">
                  Directions to self-parking:{' '}
                  <span className="font-medium">{effectiveDestination.label}</span>
                </p>
              )}
              <div
                ref={copyBlockRef}
                style={{ fontFamily: 'Arial', fontSize: '10pt' }}
              >
                <p className="leading-relaxed text-slate-700 whitespace-pre-wrap">{prose}</p>
              </div>
              {/* Hidden block used only for copying links — single line block to avoid Word text box */}
              {destinationAddress && (googleMapsUrl || appleMapsUrl) && (
                <div
                  ref={linksCopyBlockRef}
                  style={{
                    fontFamily: 'Arial',
                    fontSize: '10pt',
                    margin: 0,
                    padding: 0,
                    border: 'none',
                    outline: 'none',
                    boxShadow: 'none',
                    background: 'none',
                  }}
                  className="absolute left-[-9999px] w-[1px] h-[1px] overflow-hidden"
                  aria-hidden
                >
                  <p style={{ margin: 0, padding: 0, border: 'none', outline: 'none' }}>
                    {googleMapsUrl && (
                      <>
                        <RedPinIcon />
                        {' ['}
                        <a href={googleMapsUrl} style={{ border: 'none', outline: 'none', textDecoration: 'underline' }}>Open in Google Maps</a>
                        {']'}
                      </>
                    )}
                    {googleMapsUrl && appleMapsUrl && <br />}
                    {appleMapsUrl && (
                      <>
                        <RedPinIcon />
                        {' ['}
                        <a href={appleMapsUrl} style={{ border: 'none', outline: 'none', textDecoration: 'underline' }}>Open in Apple Maps</a>
                        {']'}
                      </>
                    )}
                  </p>
                </div>
              )}
              {destinationAddress && (googleMapsUrl || appleMapsUrl) && (
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-4">
                  {googleMapsUrl && (
                    <span className="inline-flex items-center gap-1.5 text-slate-700">
                      <span className="text-slate-500">[</span>
                      <a
                        href={googleMapsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-red-600 hover:text-red-700 hover:underline"
                      >
                        <RedPinIcon />
                        Open in Google Maps
                      </a>
                      <span className="text-slate-500">]</span>
                    </span>
                  )}
                  <span style={{ whiteSpace: 'pre' }}>{MAP_LINK_SPACER}</span>
                  {appleMapsUrl && (
                    <span className="inline-flex items-center gap-1.5 text-slate-700">
                      <span className="text-slate-500">[</span>
                      <a
                        href={appleMapsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-red-600 hover:text-red-700 hover:underline"
                      >
                        <RedPinIcon />
                        Open in Apple Maps
                      </a>
                      <span className="text-slate-500">]</span>
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <p className="mt-12 text-center text-xs text-slate-400">
          Powered by Mapbox & OpenAI · v{APP_VERSION}
        </p>
      </div>
    </div>
  )
}
