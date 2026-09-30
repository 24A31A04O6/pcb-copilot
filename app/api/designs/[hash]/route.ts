import { getVerifiedDesign } from '@/lib/server/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Permalink target: a previously verified design, by hash. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ hash: string }> },
) {
  const { hash } = await params
  const entry = await getVerifiedDesign(hash)
  if (!entry) {
    return Response.json(
      { error: 'No verified design with that hash. It may have expired, or it was never verified.' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    )
  }
  return Response.json({ design: entry }, { headers: { 'Cache-Control': 'public, max-age=60' } })
}
