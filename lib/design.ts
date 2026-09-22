export type CircuitJson = unknown[]

export type DesignDiagnostic = {
  severity: 'error' | 'warning'
  type: string
  message: string
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
}

export type DesignStreamEvent =
  | { type: 'stage'; message: string }
  | { type: 'clarification'; questions: string[] }
  | { type: 'result'; design: DesignResult }
  | { type: 'error'; message: string }
