export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return new Response(
    JSON.stringify({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '2.0-brutal',
      features: ['live-generation', 'robust-review', 'fluid-compute', 'neobrutalism'],
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    },
  )
}
