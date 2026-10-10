// Gemini via Firebase AI Logic (Gemini Developer API — free tier on the
// Spark plan, so it can't incur charges). Loaded on demand so the AI SDK
// isn't part of the startup bundle.
import { app } from './firebase.js'

// Flash-Lite answers in ~1.5s with good picks; 3.8 Flash is a slower (~30s)
// fallback. (gemini-flash-latest stalled on the free tier and 2.5 Flash is
// retired for new projects — tested October 2026.)
const MODELS = ['gemini-flash-lite-latest', 'gemini-3.8-flash']

let modulePromise = null
const loadAI = () => (modulePromise ??= import('firebase/ai'))

/**
 * Ask Gemini for authors similar to the reader's favourites.
 * Only author names, book counts, ratings and genres are sent — never notes.
 * Returns [{ author, because, books: [title, …] }].
 */
export async function suggestSimilarAuthors({ favourites, genres, alreadyRead }) {
  const { getAI, getGenerativeModel, GoogleAIBackend, Schema } = await loadAI()
  const ai = getAI(app, { backend: new GoogleAIBackend() })

  const responseSchema = Schema.object({
    properties: {
      suggestions: Schema.array({
        items: Schema.object({
          properties: {
            author: Schema.string(),
            because: Schema.string(),
            books: Schema.array({ items: Schema.string() }),
          },
        }),
      }),
    },
  })

  const prompt = `You recommend books. A reader's favourite authors (books read, average rating out of 5):
${favourites.map(f => `- ${f.author} (${f.count} read, ${f.avg ? `${f.avg}★` : 'unrated'})`).join('\n')}

Their most-read genres: ${genres.join(', ')}.

Suggest 6 published authors they have NOT read who they would likely enjoy. For each give:
- author: the author's name as it appears on their books
- because: one short sentence (max 14 words) naming which favourite author they resemble and why
- books: 2 of that author's real, published book titles that are a good starting point (titles only)

Do not suggest any of these authors they've already read: ${alreadyRead.join(', ')}.
Only suggest real authors and real book titles.`

  let lastError
  for (const name of MODELS) {
    try {
      const model = getGenerativeModel(ai, {
        model: name,
        generationConfig: { responseMimeType: 'application/json', responseSchema, temperature: 0.6 },
      }, { timeout: 45000 }) // never leave the row spinning on a stalled request
      const result = await model.generateContent(prompt)
      const parsed = JSON.parse(result.response.text())
      return (parsed.suggestions || []).filter(s => s.author && s.books?.length)
    } catch (err) {
      lastError = err
    }
  }
  throw lastError
}
