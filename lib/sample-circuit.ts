import sampleCircuitJson from './sample-circuit.json'

export type CircuitJson = unknown[]

export const SAMPLE_CIRCUIT_TSX = `export default () => (
  <board width="24mm" height="16mm">
    <chip
      name="U1"
      footprint="soic8"
      pcbX={-5}
      pcbY={0}
      schX={-4}
      schY={0}
      pinLabels={{
        pin1: "GND",
        pin2: "OUT",
        pin8: "VCC",
      }}
    />
    <resistor
      name="R1"
      resistance="220"
      footprint="0805"
      pcbX={5}
      pcbY={4}
      schX={1}
      schY={1}
    />
    <led
      name="LED1"
      color="red"
      footprint="0805"
      pcbX={5}
      pcbY={-4}
      schX={4}
      schY={1}
    />
    <trace from=".U1 .OUT" to=".R1 .pin1" />
    <trace from=".R1 .pin2" to=".LED1 .pos" />
    <trace from=".LED1 .neg" to=".U1 .GND" />
  </board>
)
`

export const SAMPLE_CIRCUIT_JSON = sampleCircuitJson as unknown as CircuitJson
