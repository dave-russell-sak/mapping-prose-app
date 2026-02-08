import express from 'express'
import { createServer as createViteServer } from 'vite'
import OpenAI from 'openai'
import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

config({ path: '.env.local' })

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
app.use(express.json())

const isProd = process.env.NODE_ENV === 'production'

async function createServer() {
  app.post('/api/generate-prose', async (req, res) => {
    try {
      const { maneuvers } = req.body
      const apiKey = process.env.OPENAI_API_KEY

      if (!apiKey) {
        return res.status(500).json({ error: 'OPENAI_API_KEY is not configured' })
      }

      if (!maneuvers || !Array.isArray(maneuvers) || maneuvers.length === 0) {
        return res.status(400).json({ error: 'Maneuvers are required' })
      }

      const openai = new OpenAI({ apiKey })
      const maneuversText = maneuvers.join('\n')

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Provide a concise, factual, and professional narrative of these directions. Avoid flowery language or conversational filler. Focus only on the sequence of roads and maneuvers. Write as a single flowing paragraph of prose. Do not use numbered lists, bullet points, or line breaks between steps.`,
          },
          {
            role: 'user',
            content: `Convert these turn-by-turn directions into friendly prose:\n\n${maneuversText}`,
          },
        ],
        temperature: 0.7,
      })

      const prose = completion.choices[0]?.message?.content?.trim() || ''
      res.json({ prose })
    } catch (err) {
      console.error('Prose generation error:', err)
      res.status(500).json({
        error: err.message || 'Failed to generate prose',
      })
    }
  })

  if (isProd) {
    app.use(express.static(join(__dirname, 'dist')))
    app.use((req, res) => {
      res.sendFile(join(__dirname, 'dist', 'index.html'))
    })
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
    })
    app.use(vite.middlewares)
  }

  return app
}

createServer().then((app) => {
  const port = process.env.PORT || 5173
  app.listen(port, () => {
    console.log(`Server running on port ${port}`)
  })
})
