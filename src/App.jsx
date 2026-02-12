import { useState, useCallback, useEffect } from 'react'
import { Copy, Check, MapPin, Loader2, RotateCcw } from 'lucide-react'
import { AddressSearch } from './components/AddressSearch'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN
const DIRECTIONS_URL = 'https://api.mapbox.com/directions/v5/mapbox/driving'
const GEOCODE_URL = 'https://api.mapbox.com/search/geocode/v6/forward'
const SEARCH_BOX_FORWARD_URL = 'https://api.mapbox.com/search/searchbox/v1/forward'
const DEFAULT_ORIGIN = '55 W. Church St., Orlando, FL 32801'

async function findParkingNear(coordinates, token) {
  const [lon, lat] = coordinates
  const params = new URLSearchParams({
    q: 'parking',
    access_token: token,
    proximity: `${lon},${lat}`,
    limit: '5',
    types: 'poi',
    country: 'US',
  })
  const res = await fetch(`${SEARCH_BOX_FORWARD_URL}?${params.toString()}`)
  const data = await res.json()
  const features = data.features || []
  const parking = features.find(
    (f) =>
      f.properties?.poi_category_ids?.some((c) =>
        ['parking', 'parking_garage', 'parking_lot'].includes(String(c).toLowerCase())
      ) ||
      /parking|garage|lot/i.test(f.properties?.name || '')
  ) || features[0]
  if (!parking?.geometry?.coordinates) return null
  const props = parking.properties || {}
  const label = props.full_address || [props.name, props.place_formatted].filter(Boolean).join(', ') || 'Parking'
  return { label, coordinates: parking.geometry.coordinates }
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
  const [useSelfParking, setUseSelfParking] = useState(false)
  const [effectiveDestination, setEffectiveDestination] = useState(null)

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
      if (useSelfParking && destination?.coordinates && MAPBOX_TOKEN) {
        const parkingResult = await findParkingNear(destination.coordinates, MAPBOX_TOKEN)
        if (parkingResult) routingDestination = parkingResult
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

  const destinationAddress = (effectiveDestination || destination)?.label || ''
  const googleMapsUrl = destinationAddress
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destinationAddress)}`
    : ''
  const appleMapsUrl = destinationAddress
    ? `https://maps.apple.com/?daddr=${encodeURIComponent(destinationAddress)}`
    : ''

  const getCopyText = () => {
    const lines = [prose]
    if (destinationAddress) {
      lines.push('')
      lines.push(`[Open in Google Maps] ${googleMapsUrl}`)
      lines.push(`[Open in Apple Maps] ${appleMapsUrl}`)
    }
    return lines.join('\n')
  }

  const handleCopy = async () => {
    if (!prose) return
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

          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
            <input
              type="checkbox"
              checked={useSelfParking}
              onChange={(e) => setUseSelfParking(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-amber-500 focus:ring-amber-500"
            />
            <span className="text-sm text-slate-700">
              Add self-parking (find parking near destination to bypass lobby/valet)
            </span>
          </label>

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
                    title="Copy to clipboard"
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
              {useSelfParking && effectiveDestination && effectiveDestination.label !== destination?.label && (
                <p className="mb-3 text-sm text-slate-600">
                  Directions to self-parking: <span className="font-medium">{effectiveDestination.label}</span>
                </p>
              )}
              <p className="leading-relaxed text-slate-700 whitespace-pre-wrap">{prose}</p>
              {destinationAddress && (googleMapsUrl || appleMapsUrl) && (
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-4">
                  {googleMapsUrl && (
                    <span className="inline-flex items-center text-slate-700">
                      <span className="text-slate-500">[</span>
                      <a
                        href={googleMapsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-red-600 hover:text-red-700 hover:underline"
                      >
                        <MapPin className="h-4 w-4 shrink-0" />
                        Open in Google Maps
                      </a>
                      <span className="text-slate-500">]</span>
                    </span>
                  )}
                  {appleMapsUrl && (
                    <span className="inline-flex items-center text-slate-700">
                      <span className="text-slate-500">[</span>
                      <a
                        href={appleMapsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-red-600 hover:text-red-700 hover:underline"
                      >
                        <MapPin className="h-4 w-4 shrink-0" />
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
          Powered by Mapbox & OpenAI
        </p>
      </div>
    </div>
  )
}
