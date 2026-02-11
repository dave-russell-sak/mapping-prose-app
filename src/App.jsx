import { useState, useCallback, useEffect } from 'react'
import { Copy, Check, MapPin, Loader2 } from 'lucide-react'
import { AddressSearch } from './components/AddressSearch'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN
const DIRECTIONS_URL = 'https://api.mapbox.com/directions/v5/mapbox/driving'
const GEOCODE_URL = 'https://api.mapbox.com/search/geocode/v6/forward'
const DEFAULT_ORIGIN = '55 W. Church St., Orlando, FL 32801'

async function geocodeAddress(address, token) {
  const res = await fetch(
    `${GEOCODE_URL}?q=${encodeURIComponent(address)}&access_token=${token}&limit=1&autocomplete=false`
  )
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

  useEffect(() => {
    if (!MAPBOX_TOKEN) {
      setOriginGeocoding(false)
      return
    }
    geocodeAddress(DEFAULT_ORIGIN, MAPBOX_TOKEN).then((result) => {
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

    try {
      const directions = await fetchRoute(origin.coordinates, destination.coordinates)
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

  const handleCopy = async () => {
    if (!prose) return
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(prose)
      } else {
        throw new Error('Clipboard not available')
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      setError(null)
    } catch {
      const textArea = document.createElement('textarea')
      textArea.value = prose
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
              </div>
              <p className="leading-relaxed text-slate-700 whitespace-pre-wrap">{prose}</p>
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
