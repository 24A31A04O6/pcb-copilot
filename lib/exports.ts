export const MANUFACTURING_BUNDLE_FILENAME = 'pcb-copilot-manufacturing.zip'

export const MANUFACTURING_BUNDLE_MIME = 'application/zip'

export function buildManufacturingBundleResponse(
  archive: ArrayBuffer | Uint8Array,
) {
  return new Response(archive, {
    headers: {
      'Content-Type': MANUFACTURING_BUNDLE_MIME,
      'Content-Disposition': `attachment; filename="${MANUFACTURING_BUNDLE_FILENAME}"`,
      'Cache-Control': 'no-store',
    },
  })
}
