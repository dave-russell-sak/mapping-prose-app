import { useState, useEffect, useRef } from 'react'

const GEOCODE_URL = 'https://api.mapbox.com/search/geocode/v6/forward'

export function AddressSearch({ value, onChange, placeholder, mapboxToken, confirmed, restrictToUS }) {
  const [inputValue, setInputValue] = useState(value || '')
  const [suggestions, setSuggestions] = useState([])
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const wrapperRef = useRef(null)

  useEffect(() => {
    setInputValue(value || '')
  }, [value])

  useEffect(() => {
    function handleClickOutside(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (confirmed || !inputValue.trim() || inputValue.length < 3) {
      setSuggestions([])
      setIsOpen(false)
      return
    }

    const timer = setTimeout(async () => {
      if (!mapboxToken) return
      setIsLoading(true)
      try {
        const params = new URLSearchParams({
          q: inputValue,
          access_token: mapboxToken,
          limit: '5',
          autocomplete: 'true',
        })
        if (restrictToUS) params.set('country', 'US')
        const res = await fetch(`${GEOCODE_URL}?${params.toString()}`)
        const data = await res.json()
        const features = data.features || []
        const seen = new Set()
        const unique = features.filter((f) => {
          const coords = f.geometry?.coordinates?.join(',')
          const addr = f.properties?.full_address || f.properties?.place_formatted || ''
          const key = `${coords || ''}|${addr}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        setSuggestions(
          unique.map((f) => {
            const props = f.properties || {}
            const name = props.name || props.address_line1 || ''
            const place = props.place_formatted || ''
            const address = props.full_address || (name && place ? `${name}, ${place}` : name || place)
            return {
              id: f.id || Math.random().toString(36),
              name: name || address,
              address: address,
              coordinates: f.geometry?.coordinates,
            }
          })
        )
        setIsOpen(true)
      } catch {
        setSuggestions([])
      } finally {
        setIsLoading(false)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [inputValue, mapboxToken, confirmed, restrictToUS])

  const selectSuggestion = (suggestion) => {
    const displayText = suggestion.address || suggestion.name
    setInputValue(displayText)
    onChange({
      label: displayText,
      coordinates: suggestion.coordinates,
    })
    setSuggestions([])
    setIsOpen(false)
  }

  const handleInputChange = (e) => {
    const v = e.target.value
    setInputValue(v)
    if (!v.trim()) onChange(null)
  }

  return (
    <div ref={wrapperRef} className="relative">
      <input
        type="text"
        value={inputValue}
        onChange={handleInputChange}
        onFocus={() => suggestions.length > 0 && setIsOpen(true)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-slate-900 placeholder-slate-400 shadow-sm transition focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
        autoComplete="off"
      />
      {isLoading && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-amber-500" />
        </div>
      )}
      {isOpen && suggestions.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {suggestions.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  selectSuggestion(s)
                }}
                className="w-full px-4 py-2.5 text-left text-sm hover:bg-amber-50 focus:bg-amber-50 focus:outline-none"
              >
                <span className="font-medium text-slate-900">{s.name}</span>
                {s.address && s.address !== s.name && (
                  <span className="block text-xs text-slate-500">{s.address}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
