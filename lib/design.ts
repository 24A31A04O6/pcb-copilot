export type CircuitJson = unknown[]

export type DesignDiagnostic = {
  severity: 'error' | 'warning'
  type: string
  message: string
  // Enhanced fields for robust review
  code?: string
  suggestion?: string
  component?: string
}

export type DesignStats = {
  components: number
  sourceTraces: number
  routedTraces: number
  pcbLayers: number
  boardWidthMm: number | null
  boardHeightMm: number | null
}

export type VerificationResult = {
  circuitJson: CircuitJson
  diagnostics: DesignDiagnostic[]
  stats: DesignStats
  verified: boolean
}

export type DesignResult = {
  tsx: string
  circuitJson: CircuitJson
  summary: string
  assumptions: string[]
  diagnostics: DesignDiagnostic[]
  stats: DesignStats
  verified: boolean
  iterations: number
  model: string
  generatedAt?: string
}

export type DesignStreamEvent =
  | { type: 'stage'; message: string; timestamp?: number }
  | { type: 'code_chunk'; chunk: string }
  | { type: 'code'; code: string }
  | { type: 'partial_result'; design: DesignResult }
  | { type: 'diagnostics'; diagnostics: DesignDiagnostic[] }
  | { type: 'clarification'; questions: string[] }
  | { type: 'result'; design: DesignResult }
  | { type: 'error'; message: string }

export function categorizeDiagnostics(diagnostics: DesignDiagnostic[]) {
  const errors = diagnostics.filter((d) => d.severity === 'error')
  const warnings = diagnostics.filter((d) => d.severity === 'warning')

  const byType = diagnostics.reduce(
    (acc, diag) => {
      const key = diag.type
      if (!acc[key]) acc[key] = []
      acc[key].push(diag)
      return acc
    },
    {} as Record<string, DesignDiagnostic[]>,
  )

  return { errors, warnings, byType, total: diagnostics.length }
}

export function getManufacturingReadinessScore(design: DesignResult): number {
  if (!design.verified) {
    const errorCount = design.diagnostics.filter((d) => d.severity === 'error').length
    return Math.max(0, 100 - errorCount * 20 - design.diagnostics.length * 5)
  }
  const warningPenalty = Math.min(30, design.diagnostics.length * 3)
  return Math.max(70, 100 - warningPenalty)
}
