export const MANUFACTURING_BUNDLE_FILENAME = 'pcb-copilot-manufacturing.zip'

export const MANUFACTURING_BUNDLE_MIME = 'application/zip'

export function buildManufacturingBundleResponse(
  archive: ArrayBuffer | Uint8Array,
  requestId?: string,
) {
  return new Response(archive, {
    headers: {
      'Content-Type': MANUFACTURING_BUNDLE_MIME,
      'Content-Disposition': `attachment; filename="${MANUFACTURING_BUNDLE_FILENAME}"`,
      'Cache-Control': 'no-store',
      'Content-Length': archive.byteLength.toString(),
      ...(requestId ? { 'X-Request-Id': requestId } : {}),
    },
  })
}

export function getExportChecklist() {
  return [
    { id: 'schematic', label: 'Schematic reviewed', description: 'All nets connected, no floating pins' },
    { id: 'footprints', label: 'Footprints verified', description: 'Check datasheets for land patterns' },
    { id: 'drc', label: 'DRC passed', description: 'Clearance, annular ring, copper to edge' },
    { id: 'bom', label: 'BOM availability', description: 'All parts in stock, lifecycle active' },
    { id: 'thermal', label: 'Thermal analysis', description: 'Power dissipation, copper pours' },
    { id: 'mechanical', label: 'Mechanical fit', description: 'Board dimensions, mounting holes' },
  ]
}
