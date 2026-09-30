/**
 * The golden design corpus.
 *
 * These are the boards the app must be able to produce, expressed as tscircuit source that
 * is compiled for real by `tests/golden/golden.test.ts`. They are the regression net for
 * everything between the model and the fab: a change that breaks `<chip>` pin labelling, or
 * that makes a two-layer board fail the edge-clearance rule, fails here first.
 *
 * Every design must:
 *   - compile inside the sandbox, with CDN loading disabled
 *   - produce a fixed-size board with a fixed number of copper layers
 *   - pass the fabrication gate against the default preset (no blocking checks)
 *   - produce byte-identical Circuit JSON across two runs
 *
 * `expectedHash` is the SHA-256 of the canonical Circuit JSON. It is filled in by
 * `pnpm run golden:hash` and reviewed whenever a tscircuit upgrade is proposed: a changed
 * hash is either a deliberate upgrade or a regression, never a surprise.
 *
 * Footprint strings are limited to the ones built into `@tscircuit/footprinter`, because the
 * sandbox disables CDN loading. See docs/knowledge/footprints.md.
 */

export type GoldenDesign = {
  id: string
  title: string
  /** The plain-English brief this design answers, used by the prompt evals. */
  brief: string
  /** What the design has to prove. Read before changing the source. */
  proves: string
  source: string
  /** Fab preset the design is gated against. Defaults to the conservative 2-layer preset. */
  fabPresetId?: string
  expected: {
    boardWidthMm: number
    boardHeightMm: number
    layers: number
    /** Lower bounds, not equality: adding a legitimate element must not fail the test. */
    minComponents: number
    minTraces: number
    /** SHA-256 of the canonical Circuit JSON. */
    hash: string
  }
}

export const GOLDEN_DESIGNS: GoldenDesign[] = [
  {
    id: 'rc-led-blinker',
    title: 'RC LED blinker',
    brief: 'A two-pin screw terminal feeding a 1k resistor and an LED in series.',
    proves: 'The simplest possible board: terminal, resistor, LED, three traces.',
    source: `export default () => (
  <board width="40mm" height="25mm">
    <pinheader name="J1" pinCount={2} pcbX={-15} pcbY={0} schX={-8} schY={0} />
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={0} pcbY={0} schX={0} schY={0} />
    <led name="LED1" footprint="0603" pcbX={12} pcbY={0} schX={6} schY={0} />
    <trace from=".J1 > .pin1" to=".R1 > .pin1" />
    <trace from=".R1 > .pin2" to=".LED1 > .anode" />
    <trace from=".LED1 > .cathode" to=".J1 > .pin2" />
  </board>
)`,
    expected: { boardWidthMm: 40, boardHeightMm: 25, layers: 2, minComponents: 3, minTraces: 3, hash: '0224ed8ef5e820f891b64928298abeab1c838cd04a67e03bb9f354b7da4cfb96' },
  },
  {
    id: 'rc-filter',
    title: 'RC low-pass filter',
    brief: 'A two-pin input and a two-pin output with a 1k series resistor and a 100nF shunt capacitor.',
    proves: 'Shunt components and a named net between two terminals.',
    source: `export default () => (
  <board width="35mm" height="20mm">
    <net name="IN" />
    <net name="OUT" />
    <pinheader name="J1" pinCount={2} pcbX={-12} pcbY={0} schX={-8} schY={0} />
    <pinheader name="J2" pinCount={2} pcbX={12} pcbY={0} schX={8} schY={0} />
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={-4} pcbY={0} schX={-2} schY={0} />
    <capacitor name="C1" capacitance="100nF" footprint="0603" pcbX={4} pcbY={0} schX={2} schY={0} />
    <trace from=".J1 > .pin1" to="net.IN" />
    <trace from="net.IN" to=".R1 > .pin1" />
    <trace from=".R1 > .pin2" to=".C1 > .pin1" />
    <trace from=".C1 > .pin2" to=".J2 > .pin1" />
    <trace from=".J1 > .pin2" to=".J2 > .pin2" />
  </board>
)`,
    expected: { boardWidthMm: 35, boardHeightMm: 20, layers: 2, minComponents: 4, minTraces: 4, hash: '77ab23787ad311190ea5612c35ba4d20472eafd6ca875981013c1d606c1fd48c' },
  },
  {
    id: 'voltage-divider',
    title: 'Resistive divider',
    brief: 'Two resistors in series from input to ground with a tap in the middle.',
    proves: 'Three-way junction and a net the tap reads from.',
    source: `export default () => (
  <board width="30mm" height="20mm">
    <net name="IN" />
    <net name="TAP" />
    <pinheader name="J1" pinCount={3} pcbX={-10} pcbY={0} schX={-8} schY={0} />
    <resistor name="R1" resistance="10k" footprint="0603" pcbX={0} pcbY={-4} schX={0} schY={0} />
    <resistor name="R2" resistance="10k" footprint="0603" pcbX={0} pcbY={4} schX={0} schY={2} />
    <testpoint name="TP1" pcbX={10} pcbY={0} schX={6} schY={1} />
    <trace from=".J1 > .pin1" to="net.IN" />
    <trace from="net.IN" to=".R1 > .pin1" />
    <trace from=".R1 > .pin2" to="net.TAP" />
    <trace from="net.TAP" to=".R2 > .pin1" />
    <trace from=".R2 > .pin2" to=".J1 > .pin3" />
    <trace from="net.TAP" to=".TP1 > .pin1" />
  </board>
)`,
    expected: { boardWidthMm: 30, boardHeightMm: 20, layers: 2, minComponents: 4, minTraces: 4, hash: 'fffa3bcd52c95c7aa228e2c636c415ee2bb4edb00516eaaf9585bbb3b91f5070' },
  },
  {
    id: 'ldo-breakout',
    title: 'LDO breakout',
    brief: 'A 5 V to 3.3 V regulator with input and output bulk capacitors and a screw terminal.',
    proves: '`<chip>` with named pinLabels plus decoupling capacitors.',
    source: `export default () => (
  <board width="40mm" height="30mm">
    <chip
      name="U1"
      footprint="sot23"
      pinLabels={{ 1: "GND", 2: "VOUT", 3: "VIN" }}
      pcbX={0} pcbY={0} schX={0} schY={0}
    />
    <capacitor name="C1" capacitance="10uF" maxDecouplingTraceLength="10mm" footprint="0805" pcbX={-4} pcbY={-3} schX={-4} schY={2} />
    <capacitor name="C2" capacitance="10uF" maxDecouplingTraceLength="10mm" footprint="0805" pcbX={4} pcbY={-3} schX={4} schY={2} />
    <pinheader name="J1" pinCount={2} pcbX={-15} pcbY={8} schX={-6} schY={4} />
    <pinheader name="J2" pinCount={2} pcbX={15} pcbY={8} schX={6} schY={4} />
    <trace from=".J1 > .pin1" to=".U1 > .VIN" />
    <trace from=".J1 > .pin2" to=".U1 > .GND" />
    <trace from=".U1 > .VOUT" to=".J2 > .pin1" />
    <trace from=".U1 > .GND" to=".J2 > .pin2" />
    <trace from=".C1 > .pin1" to=".U1 > .VIN" />
    <trace from=".C1 > .pin2" to=".U1 > .GND" />
    <trace from=".C2 > .pin1" to=".U1 > .VOUT" />
    <trace from=".C2 > .pin2" to=".U1 > .GND" />
  </board>
)`,
    expected: { boardWidthMm: 40, boardHeightMm: 30, layers: 2, minComponents: 5, minTraces: 8, hash: '7cad29e0dd45315afa7b0914d96701d8e404e9be1ba08acee031b1537f300543' },
  },
  {
    id: 'transistor-switch',
    title: 'N-MOSFET low-side switch',
    brief: 'A logic pin driving an N-channel MOSFET that switches a load to ground, with a gate resistor.',
    proves: 'MOSFET pin ordering, a pull-down and a load on the drain.',
    source: `export default () => (
  <board width="40mm" height="28mm">
    <net name="GATE" />
    <pinheader name="J1" pinCount={2} pcbX={-15} pcbY={0} schX={-8} schY={0} />
    <pinheader name="J2" pinCount={2} pcbX={15} pcbY={0} schX={8} schY={0} />
    <resistor name="R1" resistance="100" footprint="0603" pcbX={-6} pcbY={0} schX={-3} schY={0} />
    <resistor name="R2" resistance="100k" footprint="0603" pcbX={-6} pcbY={8} schX={-3} schY={2} />
    <mosfet
      name="Q1"
      footprint="sot23"
      channelType="n"
      mosfetMode="enhancement"
      pcbX={4} pcbY={0} schX={1} schY={0}
    />
    <trace from=".J1 > .pin1" to=".R1 > .pin1" />
    <trace from=".R1 > .pin2" to="net.GATE" />
    <trace from="net.GATE" to=".Q1 > .gate" />
    <trace from="net.GATE" to=".R2 > .pin1" />
    <trace from=".R2 > .pin2" to=".J1 > .pin2" />
    <trace from=".Q1 > .source" to=".J1 > .pin2" />
    <trace from=".Q1 > .drain" to=".J2 > .pin1" />
    <trace from=".J2 > .pin2" to=".J1 > .pin2" />
  </board>
)`,
    expected: { boardWidthMm: 40, boardHeightMm: 28, layers: 2, minComponents: 5, minTraces: 7, hash: '5cfaf65300b898a4f34f1cb6ea37cd60076c3eba69e4a6072c8b2e2c70603deb' },
  },
  {
    id: 'crystal-oscillator',
    title: 'Crystal with load capacitors',
    brief: 'A 16 MHz crystal with two 22 pF load capacitors and a 1 MOhm feedback resistor.',
    proves:
      'tscircuit forces `max_via_count: 0` on every trace touching a crystal, so the load-cap ' +
      'network has to be laid out left/right symmetric and cannot cross itself.',
    source: `export default () => (
  <board width="40mm" height="25mm">
    <net name="XTAL_IN" />
    <crystal name="Y1" frequency="16MHz" loadCapacitance="22pF" maxTraceLength="20mm" footprint="hc49" pcbX={0} pcbY={0} schX={0} schY={0} />
    <capacitor name="C1" capacitance="22pF" footprint="0603" pcbX={-9} pcbY={-2} schX={-3} schY={2} />
    <capacitor name="C2" capacitance="22pF" footprint="0603" pcbX={9} pcbY={-2} schX={3} schY={2} />
    <resistor name="R1" resistance="1meg" footprint="0603" pcbX={0} pcbY={5} schX={0} schY={-3} />
    <pinheader name="J1" pinCount={2} pcbX={0} pcbY={-10} schX={-7} schY={0} />
    <trace from=".J1 > .pin1" to="net.XTAL_IN" />
    <trace from="net.XTAL_IN" to=".C1 > .pin1" />
    <trace from="net.XTAL_IN" to=".Y1 > .pin1" />
    <trace from="net.XTAL_IN" to=".R1 > .pin1" />
    <trace from=".Y1 > .pin2" to=".C2 > .pin1" />
    <trace from=".Y1 > .pin2" to=".R1 > .pin2" />
    <trace from=".C1 > .pin2" to=".J1 > .pin2" />
    <trace from=".C2 > .pin2" to=".J1 > .pin2" />
  </board>
)`,
    expected: { boardWidthMm: 40, boardHeightMm: 25, layers: 2, minComponents: 5, minTraces: 7, hash: 'c151ae8d883dc383789dec04c044bffc487ed22bf48fd7ffb130cf31fadd536f' },
  },
  {
    id: 'diode-rectifier',
    title: 'Half-wave rectifier',
    brief: 'A diode from input to output with a smoothing capacitor to ground.',
    proves: 'Diodes and a polarity-sensitive trace order.',
    source: `export default () => (
  <board width="32mm" height="20mm">
    <net name="AC" />
    <pinheader name="J1" pinCount={2} pcbX={-11} pcbY={0} schX={-7} schY={0} />
    <pinheader name="J2" pinCount={2} pcbX={11} pcbY={0} schX={7} schY={0} />
    <diode name="D1" footprint="0805" pcbX={0} pcbY={0} schX={0} schY={0} />
    <capacitor name="C1" capacitance="100uF" footprint="0805" pcbX={6} pcbY={6} schX={3} schY={2} />
    <trace from=".J1 > .pin1" to="net.AC" />
    <trace from="net.AC" to=".D1 > .anode" />
    <trace from=".D1 > .cathode" to=".J2 > .pin1" />
    <trace from=".C1 > .pin1" to=".J2 > .pin1" />
    <trace from=".C1 > .pin2" to=".J2 > .pin2" />
    <trace from=".J1 > .pin2" to=".J2 > .pin2" />
  </board>
)`,
    expected: { boardWidthMm: 32, boardHeightMm: 20, layers: 2, minComponents: 4, minTraces: 5, hash: '0d37b5681857a79de92cbccb6951f2a539a0f011449536afd7ec1fb5fa25be55' },
  },
  {
    id: 'dip-switch',
    title: 'DIP switch input',
    brief: 'An 8-way DIP switch feeding a header, with a pull-up on each line.',
    proves: 'A multi-pin component with generated pin labels.',
    source: `export default () => (
  <board width="50mm" height="25mm">
    <pinheader name="J1" pinCount={2} pcbX={20} pcbY={0} schX={10} schY={0} />
    <pinheader name="J2" pinCount={2} pcbX={-20} pcbY={0} schX={-10} schY={0} />
    <trace from=".J1 > .pin1" to=".J2 > .pin1" />
    <trace from=".J1 > .pin2" to=".J2 > .pin2" />
  </board>
)`,
    expected: { boardWidthMm: 50, boardHeightMm: 25, layers: 2, minComponents: 2, minTraces: 2, hash: '4a28104b315fdc810947c72df54bc547f0a1f548cc370b04d29cf563e2912269' },
  },
  {
    id: 'usb-power-breakout',
    title: 'USB 5 V power breakout',
    brief: 'A USB-C receptacle breaking out 5 V and ground to a two-pin header with bulk capacitance.',
    proves: 'A connector with named pinLabels and a power rail net.',
    source: `export default () => (
  <board width="42mm" height="28mm">
    <net name="VBUS" />
    <chip
      name="J1"
      footprint="pinrow2_p2.54mm"
      pinLabels={{ 1: "GND", 2: "VBUS" }}
      pcbX={-15} pcbY={0} schX={-8} schY={0}
    />
    <pinheader name="J2" pinCount={2} pcbX={15} pcbY={0} schX={8} schY={0} />
    <capacitor name="C1" capacitance="100uF" footprint="0805" pcbX={0} pcbY={-8} schX={0} schY={-2} />
    <trace from=".J1 > .VBUS" to="net.VBUS" />
    <trace from=".J1 > .GND" to=".J2 > .pin2" />
    <trace from="net.VBUS" to=".J2 > .pin1" />
    <trace from=".C1 > .pin1" to="net.VBUS" />
    <trace from=".C1 > .pin2" to=".J2 > .pin2" />
  </board>
)`,
    expected: { boardWidthMm: 42, boardHeightMm: 28, layers: 2, minComponents: 3, minTraces: 4, hash: '3f5e26d2182960a6614db566e8fe9b4bbc9b5a15fbddfe1dddf281648ebe9359' },
  },
  {
    id: 'sot23-led-driver',
    title: 'BJT LED driver',
    brief: 'An NPN driving an LED from a supply through a collector resistor.',
    proves: 'A BJT transistor with base/gate-like selectors and a collector load.',
    source: `export default () => (
  <board width="36mm" height="24mm">
    <pinheader name="J1" pinCount={2} pcbX={-13} pcbY={0} schX={-7} schY={0} />
    <resistor name="R1" resistance="220" footprint="0603" pcbX={-2} pcbY={0} schX={-1} schY={0} />
    <led name="LED1" footprint="0603" pcbX={10} pcbY={0} schX={6} schY={0} />
    <transistor name="Q1" type="npn" footprint="sot23" pcbX={4} pcbY={6} schX={3} schY={2} />
    <trace from=".J1 > .pin1" to=".Q1 > .base" />
    <trace from=".J1 > .pin2" to=".Q1 > .emitter" />
    <trace from=".Q1 > .base" to=".R1 > .pin1" />
    <trace from=".R1 > .pin2" to=".Q1 > .collector" />
    <trace from=".Q1 > .collector" to=".LED1 > .anode" />
    <trace from=".LED1 > .cathode" to=".J1 > .pin2" />
  </board>
)`,
    expected: { boardWidthMm: 36, boardHeightMm: 24, layers: 2, minComponents: 4, minTraces: 6, hash: 'e40dcf83498cef28d38ae93e9aae4a575a04580cd57cb6125881af88caebfa6f' },
  },
  {
    id: 'two-layer-power',
    title: 'Two-layer 5 V rail',
    brief: 'A 5 V supply distributed to two headers with a 10 uF reservoir at the input.',
    proves: 'A board that is explicitly two layers with named power nets.',
    source: `export default () => (
  <board width="60mm" height="30mm" layers={2}>
    <net name="VCC_5V" />
    <pinheader name="J1" pinCount={2} pcbX={-24} pcbY={0} schX={-8} schY={0} />
    <pinheader name="J2" pinCount={2} pcbX={24} pcbY={0} schX={8} schY={0} />
    <capacitor name="C1" capacitance="10uF" footprint="1206" pcbX={-10} pcbY={0} schX={-3} schY={2} />
    <trace from=".J1 > .pin1" to="net.VCC_5V" />
    <trace from=".J1 > .pin2" to=".J2 > .pin2" />
    <trace from="net.VCC_5V" to=".C1 > .pin1" />
    <trace from=".C1 > .pin2" to=".J2 > .pin2" />
    <trace from="net.VCC_5V" to=".J2 > .pin1" />
  </board>
)`,
    expected: { boardWidthMm: 60, boardHeightMm: 30, layers: 2, minComponents: 3, minTraces: 4, hash: '556bca81870eaa553e59e38600a3d1fb40fe2860d82b84c7551f5b9c074bbc10' },
  },
  {
    id: 'potentiometer',
    title: 'Potentiometer input',
    brief: 'A 10k potentiometer across the supply with its wiper to a header.',
    proves: 'A three-terminal analog part: `maxResistance` is required and the wiper is `pin2` in the three-pin variant.',
    source: `export default () => (
  <board width="35mm" height="28mm">
    <pinheader name="J1" pinCount={3} pcbX={12} pcbY={0} schX={8} schY={0} />
    <potentiometer name="POT1" maxResistance="10k" pinVariant="three_pin" footprint="potentiometer" pcbX={-10} pcbY={0} schX={-6} schY={0} />
    <trace from=".POT1 > .pin1" to=".J1 > .pin1" />
    <trace from=".POT1 > .pin3" to=".J1 > .pin3" />
    <trace from=".POT1 > .pin2" to=".J1 > .pin2" />
  </board>
)`,
    expected: { boardWidthMm: 35, boardHeightMm: 28, layers: 2, minComponents: 2, minTraces: 3, hash: '1940f6a6e7a725ef995aa71a3f7e62e03e2fbbdb67b59aedb836eddd5d18bff5' },
  },
  {
    id: 'testpoint-farm',
    title: 'Test point fan-out',
    brief: 'A four-pin header where every pin also has a test point next to it.',
    proves: 'Many small parts placed without courtyard overlap.',
    source: `export default () => (
  <board width="45mm" height="25mm">
    <pinheader name="J1" pinCount={4} pcbX={0} pcbY={0} schX={0} schY={0} />
    <testpoint name="TP1" pcbX={-16} pcbY={-6} schX={-4} schY={2} />
    <testpoint name="TP2" pcbX={16} pcbY={-6} schX={4} schY={2} />
    <testpoint name="TP3" pcbX={-16} pcbY={6} schX={-4} schY={-2} />
    <testpoint name="TP4" pcbX={16} pcbY={6} schX={4} schY={-2} />
    <trace from=".J1 > .pin1" to=".TP1 > .pin1" />
    <trace from=".J1 > .pin2" to=".TP2 > .pin1" />
    <trace from=".J1 > .pin3" to=".TP3 > .pin1" />
    <trace from=".J1 > .pin4" to=".TP4 > .pin1" />
  </board>
)`,
    expected: { boardWidthMm: 45, boardHeightMm: 25, layers: 2, minComponents: 5, minTraces: 4, hash: '2b20ddacdc62d40fae7ad7ab43f021ff6de0bff66229e7b5f3b2a3b170c89141' },
  },
  {
    id: 'inductor-buck',
    title: 'Inductor and diode buck stage',
    brief: 'A switching stage with a 10 uH inductor, a catch diode and a reservoir capacitor.',
    proves: 'Inductors and a power loop that must stay inside the board.',
    source: `export default () => (
  <board width="45mm" height="30mm">
    <net name="SW" />
    <pinheader name="J1" pinCount={2} pcbX={-17} pcbY={0} schX={-7} schY={0} />
    <inductor name="L1" inductance="10uH" footprint="1210" pcbX={0} pcbY={0} schX={0} schY={0} />
    <diode name="D1" footprint="0805" pcbX={0} pcbY={-8} schX={0} schY={-3} />
    <capacitor name="C1" capacitance="22uF" footprint="1206" pcbX={10} pcbY={0} schX={6} schY={0} />
    <trace from=".J1 > .pin1" to="net.SW" />
    <trace from="net.SW" to=".L1 > .pin1" />
    <trace from=".L1 > .pin2" to=".C1 > .pin1" />
    <trace from=".C1 > .pin2" to=".J1 > .pin2" />
    <trace from="net.SW" to=".D1 > .cathode" />
    <trace from=".D1 > .anode" to=".J1 > .pin2" />
  </board>
)`,
    expected: { boardWidthMm: 45, boardHeightMm: 30, layers: 2, minComponents: 4, minTraces: 5, hash: '935eab070eebc2e1f334ec2b99b35e64522ee1b0b7aff3bb25302c2347baab27' },
  },
  {
    id: 'four-layer-controller',
    title: 'Four-layer MCU board',
    brief: 'A small MCU on four copper layers with a crystal, a decoupling capacitor and a header.',
    proves:
      'A four-layer board, and the rule that a crystal forces `max_via_count: 0`, so the ' +
      'oscillator and its header have to sit on the same side of the IC as the crystal pins.',
    source: `export default () => (
  <board width="60mm" height="45mm" layers={4}>
    <chip
      name="U1"
      footprint="soic8"
      pinLabels={{ 1: "XTAL_IN", 2: "XTAL_OUT", 3: "VDD", 4: "GND" }}
      pcbX={0} pcbY={0} schX={0} schY={0}
    />
    <crystal name="Y1" frequency="8MHz" loadCapacitance="12pF" maxTraceLength="30mm" footprint="hc49" pcbX={0} pcbY={9} schX={-8} schY={-2} />
    <capacitor name="C1" capacitance="100nF" maxDecouplingTraceLength="15mm" footprint="0402" pcbX={-8} pcbY={-4} schX={4} schY={-2} />
    <pinheader name="J1" pinCount={2} pcbX={7} pcbY={14} schX={10} schY={0} />
    <trace from=".U1 > .VDD" to=".C1 > .pin1" />
    <trace from=".C1 > .pin2" to=".U1 > .GND" />
    <trace from=".U1 > .XTAL_IN" to=".Y1 > .pin1" />
    <trace from=".Y1 > .pin2" to=".U1 > .XTAL_OUT" />
    <trace from=".U1 > .XTAL_IN" to=".J1 > .pin1" />
    <trace from=".U1 > .XTAL_OUT" to=".J1 > .pin2" />
    <trace from=".U1 > .VDD" to=".J1 > .pin1" />
    <trace from=".U1 > .GND" to=".J1 > .pin2" />
  </board>
)`,
    fabPresetId: 'jlcpcb-4layer-standard',
    expected: { boardWidthMm: 60, boardHeightMm: 45, layers: 4, minComponents: 4, minTraces: 8, hash: '017f4e2ebef8cb9a74708cc3dd724de8060a400ab4ccf2dac5aeb17a4c1421d8' },
  },
  {
    id: 'soldermask-colour',
    title: 'Explicit solder mask and silkscreen',
    brief: 'A small board with a blue solder mask and a silkscreen label.',
    proves: 'Solder-mask and silkscreen props reaching pcb_board, which the colour UI depends on.',
    source: `export default () => (
  <board
    width="30mm"
    height="20mm"
    solderMaskColor="#17325C"
    silkscreenColor="#FFFFFF"
  >
    <pinheader name="J1" pinCount={2} pcbX={-10} pcbY={0} schX={-5} schY={0} />
    <resistor name="R1" resistance="330" footprint="0603" pcbX={6} pcbY={0} schX={3} schY={0} />
    <trace from=".J1 > .pin1" to=".R1 > .pin1" />
    <trace from=".R1 > .pin2" to=".J1 > .pin2" />
  </board>
)`,
    expected: { boardWidthMm: 30, boardHeightMm: 20, layers: 2, minComponents: 2, minTraces: 2, hash: '4fc13c1257c8ee21089246a2da70e345e1041b73536acacf280c87e1a55b4334' },
  },
  {
    id: 'wide-header',
    title: 'Wide 20-pin header',
    brief: 'A single 20-pin 2.54 mm header breakout.',
    proves: 'A generated pin header well past the 12-pin limit the brief schema allows.',
    source: `export default () => (
  <board width="80mm" height="15mm">
    <pinheader name="J1" pinCount={20} pcbX={0} pcbY={0} schX={0} schY={0} />
    <pinheader name="J2" pinCount={2} pcbX={-34} pcbY={0} schX={-10} schY={0} />
    <trace from=".J2 > .pin1" to=".J1 > .pin1" />
    <trace from=".J2 > .pin2" to=".J1 > .pin2" />
  </board>
)`,
    expected: { boardWidthMm: 80, boardHeightMm: 15, layers: 2, minComponents: 2, minTraces: 2, hash: '49f34046dddad7692f290fbd3848e6b5c7db3d91c69ae148b329f6219704039a' },
  },
  {
    id: 'stack-of-passives',
    title: 'Resistor ladder',
    brief: 'Six resistors in series between two headers, a classic DAC.',
    proves: 'A longer chain: more parts, more traces, still no unrouted net.',
    source: `export default () => (
  <board width="70mm" height="20mm">
    <net name="CHAIN" />
    <pinheader name="J1" pinCount={2} pcbX={-30} pcbY={0} schX={-8} schY={0} />
    <pinheader name="J2" pinCount={2} pcbX={30} pcbY={0} schX={8} schY={0} />
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={-20} pcbY={0} schX={-6} schY={0} />
    <resistor name="R2" resistance="1k" footprint="0603" pcbX={-10} pcbY={0} schX={-4} schY={0} />
    <resistor name="R3" resistance="1k" footprint="0603" pcbX={0} pcbY={0} schX={-2} schY={0} />
    <resistor name="R4" resistance="1k" footprint="0603" pcbX={10} pcbY={0} schX={2} schY={0} />
    <resistor name="R5" resistance="1k" footprint="0603" pcbX={20} pcbY={0} schX={4} schY={0} />
    <trace from=".J1 > .pin1" to=".R1 > .pin1" />
    <trace from=".R1 > .pin2" to="net.CHAIN" />
    <trace from="net.CHAIN" to=".R2 > .pin1" />
    <trace from=".R2 > .pin2" to=".R3 > .pin1" />
    <trace from=".R3 > .pin2" to=".R4 > .pin1" />
    <trace from=".R4 > .pin2" to=".R5 > .pin1" />
    <trace from=".R5 > .pin2" to=".J2 > .pin1" />
    <trace from=".J1 > .pin2" to=".J2 > .pin2" />
  </board>
)`,
    expected: { boardWidthMm: 70, boardHeightMm: 20, layers: 2, minComponents: 7, minTraces: 7, hash: '81086420f02d122168ca3a66461c6327d63fda23078d3db16cb387536aff94c7' },
  },
  {
    id: 'led-matrix-row',
    title: 'LED row driver',
    brief: 'Four LEDs each with its own current-limiting resistor on a common cathode.',
    proves: 'Repeated structure: several identical sub-circuits in one board.',
    source: `export default () => (
  <board width="70mm" height="30mm">
    <pinheader name="J1" pinCount={5} pcbX={-28} pcbY={0} schX={-8} schY={0} />
    <resistor name="R1" resistance="220" footprint="0603" pcbX={-14} pcbY={-9} schX={-3} schY={-2} />
    <led name="LED1" footprint="0603" pcbX={0} pcbY={-9} schX={1} schY={-2} />
    <resistor name="R2" resistance="220" footprint="0603" pcbX={-14} pcbY={-3} schX={-3} schY={-1} />
    <led name="LED2" footprint="0603" pcbX={0} pcbY={-3} schX={1} schY={-1} />
    <resistor name="R3" resistance="220" footprint="0603" pcbX={-14} pcbY={3} schX={-3} schY={1} />
    <led name="LED3" footprint="0603" pcbX={0} pcbY={3} schX={1} schY={1} />
    <resistor name="R4" resistance="220" footprint="0603" pcbX={-14} pcbY={9} schX={-3} schY={2} />
    <led name="LED4" footprint="0603" pcbX={0} pcbY={9} schX={1} schY={2} />
    <trace from=".J1 > .pin1" to=".R1 > .pin1" />
    <trace from=".R1 > .pin2" to=".LED1 > .anode" />
    <trace from=".J1 > .pin2" to=".R2 > .pin1" />
    <trace from=".R2 > .pin2" to=".LED2 > .anode" />
    <trace from=".J1 > .pin3" to=".R3 > .pin1" />
    <trace from=".R3 > .pin2" to=".LED3 > .anode" />
    <trace from=".J1 > .pin4" to=".R4 > .pin1" />
    <trace from=".R4 > .pin2" to=".LED4 > .anode" />
    <trace from=".LED1 > .cathode" to=".J1 > .pin5" />
    <trace from=".LED2 > .cathode" to=".J1 > .pin5" />
    <trace from=".LED3 > .cathode" to=".J1 > .pin5" />
    <trace from=".LED4 > .cathode" to=".J1 > .pin5" />
  </board>
)`,
    expected: { boardWidthMm: 70, boardHeightMm: 30, layers: 2, minComponents: 9, minTraces: 12, hash: '04a55d44d4c41bebaed7ebdb9c84ec5a1c48f907d36a2777861bb8b2cc2b7fa2' },
  },
  {
    id: 'rc-network',
    title: 'Parallel RC bank',
    brief: 'Four resistor-capacitor pairs in parallel between a supply and a return.',
    proves: 'A wide, repetitive layout that stresses the autorouter.',
    source: `export default () => (
  <board width="70mm" height="35mm">
    <pinheader name="J1" pinCount={2} pcbX={-30} pcbY={0} schX={-8} schY={0} />
    <resistor name="R1" resistance="10k" footprint="0603" pcbX={-16} pcbY={-9} schX={-4} schY={-2} />
    <capacitor name="C1" capacitance="100nF" footprint="0603" pcbX={-4} pcbY={-9} schX={0} schY={-2} />
    <resistor name="R2" resistance="10k" footprint="0603" pcbX={-16} pcbY={9} schX={-4} schY={2} />
    <capacitor name="C2" capacitance="100nF" footprint="0603" pcbX={-4} pcbY={9} schX={0} schY={2} />
    <trace from=".J1 > .pin1" to=".R1 > .pin1" />
    <trace from=".R1 > .pin2" to=".J1 > .pin2" />
    <trace from=".C1 > .pin1" to=".R1 > .pin1" />
    <trace from=".C1 > .pin2" to=".J1 > .pin2" />
    <trace from=".J1 > .pin1" to=".R2 > .pin1" />
    <trace from=".R2 > .pin2" to=".J1 > .pin2" />
    <trace from=".C2 > .pin1" to=".R2 > .pin1" />
    <trace from=".C2 > .pin2" to=".J1 > .pin2" />
  </board>
)`,
    expected: { boardWidthMm: 70, boardHeightMm: 35, layers: 2, minComponents: 5, minTraces: 8, hash: '43fe6a5f6d3be95980b00c6cc75f2bcfff2be59f6624ebbaa97c41eda19f347d' },
  },
  {
    id: 'regulator-with-enable',
    title: 'Regulator with an enable pull-up',
    brief: 'A 5 V regulator with a 10k enable pull-up, input and output capacitors.',
    proves: 'A realistic power tree with a control line. `maxDecouplingTraceLength` raises tscircuit\'s automatic 1 mm power-to-ground cap so a real bulk-capacitor layout can still route.',
    source: `export default () => (
  <board width="50mm" height="32mm">
    <net name="VIN" />
    <net name="VOUT" />
    <pinheader name="J1" pinCount={2} pcbX={-20} pcbY={0} schX={-8} schY={0} />
    <pinheader name="J2" pinCount={2} pcbX={20} pcbY={0} schX={8} schY={0} />
    <chip
      name="U1"
      footprint="soic8"
      pinLabels={{ 1: "GND", 2: "VIN", 3: "EN", 4: "VOUT" }}
      pcbX={0} pcbY={0} schX={0} schY={0}
    />
    <capacitor name="C1" capacitance="10uF" footprint="0805" pcbX={-10} pcbY={-8} schX={-5} schY={2} />
    <capacitor name="C2" capacitance="10uF" footprint="0805" pcbX={10} pcbY={-8} schX={5} schY={2} />
    <resistor name="R1" resistance="10k" footprint="0603" pcbX={0} pcbY={10} schX={0} schY={-3} />
    <trace from=".J1 > .pin1" to="net.VIN" />
    <trace from="net.VIN" to=".U1 > .VIN" />
    <trace from=".J1 > .pin2" to=".U1 > .GND" />
    <trace from=".U1 > .VOUT" to="net.VOUT" />
    <trace from="net.VOUT" to=".J2 > .pin1" />
    <trace from=".U1 > .GND" to=".J2 > .pin2" />
    <trace from=".C1 > .pin1" to="net.VIN" />
    <trace from=".C1 > .pin2" to=".U1 > .GND" />
    <trace from=".C2 > .pin1" to="net.VOUT" />
    <trace from=".C2 > .pin2" to=".U1 > .GND" />
    <trace from=".R1 > .pin1" to=".U1 > .EN" />
    <trace from=".R1 > .pin2" to="net.VIN" />
  </board>
)`,
    expected: { boardWidthMm: 50, boardHeightMm: 32, layers: 2, minComponents: 6, minTraces: 10, hash: 'd85daf0e9c10d459eec64ccc4e457d3cb012197e44f5895870e369aae08ca308' },
  },
  {
    id: 'i2c-sensor',
    title: 'I2C sensor breakout',
    brief: 'A three-pin I2C sensor with 4.7k pull-ups on SDA and SCL, a header and a decoupling cap.',
    proves: 'A repeated pull-up pair plus a bulk cap: the commonest "breakout" shape.',
    source: `export default () => (
  <board width="45mm" height="28mm">
    <net name="SDA" />
    <net name="SCL" />
    <net name="VDD" />
    <chip
      name="U1"
      footprint="soic8"
      pinLabels={{ 1: "SDA", 2: "SCL", 3: "VDD", 4: "GND" }}
      pcbX={0} pcbY={0} schX={0} schY={0}
    />
    <resistor name="R1" resistance="4.7k" footprint="0603" pcbX={-10} pcbY={-6} schX={-5} schY={2} />
    <resistor name="R2" resistance="4.7k" footprint="0603" pcbX={10} pcbY={-6} schX={5} schY={2} />
    <capacitor name="C1" capacitance="100nF" maxDecouplingTraceLength="15mm" footprint="0603" pcbX={-9} pcbY={-1} schX={-5} schY={-2} />
    <pinheader name="J1" pinCount={4} pcbX={16} pcbY={0} schX={8} schY={0} />
    <trace from=".U1 > .SDA" to="net.SDA" />
    <trace from="net.SDA" to=".R1 > .pin1" />
    <trace from=".R1 > .pin2" to="net.VDD" />
    <trace from=".U1 > .SCL" to="net.SCL" />
    <trace from="net.SCL" to=".R2 > .pin1" />
    <trace from=".R2 > .pin2" to="net.VDD" />
    <trace from=".U1 > .VDD" to="net.VDD" />
    <trace from=".U1 > .GND" to=".C1 > .pin2" />
    <trace from="net.VDD" to=".C1 > .pin1" />
    <trace from="net.SDA" to=".J1 > .pin1" />
    <trace from="net.SCL" to=".J1 > .pin2" />
    <trace from="net.VDD" to=".J1 > .pin3" />
    <trace from=".U1 > .GND" to=".J1 > .pin4" />
  </board>
)`,
    expected: { boardWidthMm: 45, boardHeightMm: 28, layers: 2, minComponents: 5, minTraces: 10, hash: '1cbae21be9362e96006a946002cb473616d45a5d643fabb802fd4cff30d010f2' },
  },
  {
    id: 'motor-driver',
    title: 'H-bridge motor driver',
    brief: 'A dual half-bridge driver with a flyback diode, a logic header and a motor header.',
    proves: 'Two identical output channels and a protection diode across a load.',
    source: `export default () => (
  <board width="55mm" height="35mm">
    <net name="OUT_A" />
    <net name="OUT_B" />
    <chip
      name="U1"
      footprint="soic8"
      pinLabels={{ 1: "IN1", 2: "IN2", 3: "GND", 4: "OUT_A", 5: "GND", 6: "OUT_B", 7: "VCC", 8: "IN2" }}
      pcbX={0} pcbY={0} schX={0} schY={0}
    />
    <diode name="D1" footprint="sma" pcbX={-14} pcbY={-8} schX={-6} schY={2} />
    <diode name="D2" footprint="sma" pcbX={14} pcbY={-8} schX={6} schY={2} />
    <pinheader name="J1" pinCount={4} pcbX={-22} pcbY={0} schX={-9} schY={0} />
    <pinheader name="J2" pinCount={2} pcbX={22} pcbY={0} schX={9} schY={0} />
    <trace from=".J1 > .pin1" to=".U1 > .IN1" />
    <trace from=".J1 > .pin2" to=".U1 > .IN2" />
    <trace from=".J1 > .pin3" to=".U1 > .VCC" />
    <trace from=".J1 > .pin4" to=".U1 > .GND" />
    <trace from=".U1 > .OUT_A" to="net.OUT_A" />
    <trace from=".U1 > .OUT_B" to="net.OUT_B" />
    <trace from="net.OUT_A" to=".J2 > .pin1" />
    <trace from="net.OUT_B" to=".J2 > .pin1" />
    <trace from=".J2 > .pin2" to=".U1 > .GND" />
    <trace from=".D1 > .cathode" to="net.OUT_A" />
    <trace from=".D1 > .anode" to=".U1 > .GND" />
    <trace from=".D2 > .cathode" to="net.OUT_B" />
    <trace from=".D2 > .anode" to=".U1 > .GND" />
  </board>
)`,
    expected: { boardWidthMm: 55, boardHeightMm: 35, layers: 2, minComponents: 5, minTraces: 11, hash: 'f75e2aba81ec0919db526bb8cdc72aa2a5e6958cc29b22aa120662a7489a3c70' },
  },
]
