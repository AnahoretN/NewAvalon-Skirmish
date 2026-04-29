/**
 * VU System Testing Utilities
 *
 * Helper functions for testing and debugging VU (Virtual Unit) system
 */

/**
 * Get current VU base value in pixels
 * 1 VU = 0.1% of viewport height
 */
export function getCurrentVuBase(): number {
  if (typeof window === 'undefined') {
    return 1.08 // Standard 1080p: 1080 * 0.001 = 1.08px
  }

  return window.innerHeight * 0.001 // CSS пиксели, автоматически компенсируют zoom
}

/**
 * Convert VU units to pixels for current viewport
 */
export function vuToPx(vuUnits: number): number {
  return vuUnits * getCurrentVuBase()
}

/**
 * Convert pixels to VU units for current viewport
 */
export function pxToVu(px: number): number {
  return px / getCurrentVuBase()
}

/**
 * Get all computed VU variables from CSS
 */
export function getComputedVuVariables(): Record<string, string> {
  if (typeof window === 'undefined') {
    return {}
  }

  const root = document.documentElement
  const styles = getComputedStyle(root)

  const vuVariables: Record<string, string> = {}

  // Get all CSS variables starting with --vu
  for (let i = 0; i < styles.length; i++) {
    const property = styles[i]
    if (property.startsWith('--vu')) {
      vuVariables[property] = styles.getPropertyValue(property)
    }
  }

  return vuVariables
}

/**
 * Parse calc() expression and return computed value in pixels
 */
export function parseCalcValue(calcExpression: string): number {
  if (typeof window === 'undefined') {
    return 0
  }

  // Create a temporary element to measure the calculated value
  const temp = document.createElement('div')
  temp.style.position = 'absolute'
  temp.style.visibility = 'hidden'
  temp.style.height = calcExpression
  document.body.appendChild(temp)

  const computedHeight = parseFloat(getComputedStyle(temp).height)
  document.body.removeChild(temp)

  return computedHeight
}

/**
 * Test if VU variable matches expected pixel range
 */
export function testVuVariable(
  variableName: string,
  expectedPx: number,
  tolerance: number = 2
): { pass: boolean; actual: number; expected: number; diff: number } {
  if (typeof window === 'undefined') {
    return { pass: false, actual: 0, expected: expectedPx, diff: expectedPx }
  }

  const root = document.documentElement
  const styles = getComputedStyle(root)
  const variableValue = styles.getPropertyValue(variableName)

  if (!variableValue) {
    throw new Error(`VU variable ${variableName} not found`)
  }

  const actualPx = parseCalcValue(variableValue)
  const diff = Math.abs(actualPx - expectedPx)

  return {
    pass: diff <= tolerance,
    actual: actualPx,
    expected: expectedPx,
    diff,
  }
}

/**
 * Get viewport info for debugging
 */
export function getViewportInfo(): {
  width: number
  height: number
  vuBase: number
  aspectRatio: number
  devicePixelRatio: number
} {
  if (typeof window === 'undefined') {
    return {
      width: 1920,
      height: 1080,
      vuBase: 1.08,
      aspectRatio: 16 / 9,
      devicePixelRatio: 1,
    }
  }

  return {
    width: window.innerWidth,
    height: window.innerHeight,
    vuBase: getCurrentVuBase(),
    aspectRatio: window.innerWidth / window.innerHeight,
    devicePixelRatio: window.devicePixelRatio || 1,
  }
}

/**
 * Log VU system status to console
 */
export function logVuSystemStatus(): void {
  if (typeof window === 'undefined') {
    return
  }

  const info = getViewportInfo()
  const vuVars = getComputedVuVariables()

}

/**
 * Run comprehensive VU system tests
 */
export function runVuTests(): {
  pass: boolean
  results: Array<{ name: string; pass: boolean; details?: any }>
} {
  if (typeof window === 'undefined') {
    return {
      pass: false,
      results: [{ name: 'Server-side', pass: false, details: 'Cannot test on server' }],
    }
  }

  const results: Array<{ name: string; pass: boolean; details?: any }> = []
  const info = getViewportInfo()

  // Test 1: VU base calculation
  const expectedVuBase = info.height * 0.001
  results.push({
    name: 'VU Base Calculation',
    pass: Math.abs(getCurrentVuBase() - expectedVuBase) < 0.01,
    details: { actual: getCurrentVuBase(), expected: expectedVuBase },
  })

  // Test 2: CSS variables exist
  const vuVars = getComputedVuVariables()
  results.push({
    name: 'CSS Variables Exist',
    pass: Object.keys(vuVars).length > 0,
    details: { count: Object.keys(vuVars).length },
  })

  // Test 3: Key VU variables
  const keyVariables = [
    { name: '--vu-base', expected: info.height * 0.001 },
    { name: '--vu-card-normal', expected: 128 * (info.height * 0.001) },
    { name: '--vu-text-base', expected: 8 * (info.height * 0.001) },
  ]

  keyVariables.forEach(({ name, expected }) => {
    const result = testVuVariable(name, expected, 1)
    results.push({
      name: `VU Variable: ${name}`,
      pass: result.pass,
      details: result,
    })
  })

  // Test 4: VU to Px conversion
  const testVu = 100
  const pxValue = vuToPx(testVu)
  const expectedPx = testVu * info.vuBase
  results.push({
    name: 'VU to Px Conversion',
    pass: Math.abs(pxValue - expectedPx) < 0.1,
    details: { vu: testVu, actualPx: pxValue, expectedPx },
  })

  const allPass = results.every((r) => r.pass)

  results.forEach((result) => {
    const icon = result.pass ? '✅' : '❌'
  })

  return { pass: allPass, results }
}

/**
 * Create a visual VU test overlay
 */
export function createVuTestOverlay(): HTMLElement {
  const overlay = document.createElement('div')
  overlay.id = 'vu-test-overlay'
  overlay.style.cssText = `
    position: fixed;
    top: 10px;
    right: 10px;
    background: rgba(0, 0, 0, 0.9);
    color: #0f0;
    font-family: monospace;
    font-size: 12px;
    padding: 10px;
    border-radius: 5px;
    z-index: 999999;
    max-width: 300px;
    pointer-events: none;
  `

  const updateOverlay = () => {
    const info = getViewportInfo()
    overlay.innerHTML = `
      <div style="font-weight: bold; margin-bottom: 5px;">VU System Debug</div>
      <div>Viewport: ${info.width}×${info.height}</div>
      <div>VU Base: ${info.vuBase.toFixed(3)}px</div>
      <div>Aspect: ${info.aspectRatio.toFixed(2)}</div>
      <div>DPR: ${info.devicePixelRatio}</div>
      <hr style="margin: 5px 0; border-color: #0f0;">
      <div style="font-size: 10px;">
        1 VU = ${info.vuBase.toFixed(2)}px<br>
        100 VU = ${(100 * info.vuBase).toFixed(1)}px<br>
        Card = ${(118 * info.vuBase).toFixed(1)}px
      </div>
    `
  }

  updateOverlay()
  window.addEventListener('resize', updateOverlay)

  return overlay
}

/**
 * Show VU test overlay on page
 */
export function showVuTestOverlay(): void {
  if (typeof window === 'undefined') {
    return
  }

  // Remove existing overlay if present
  const existing = document.getElementById('vu-test-overlay')
  if (existing) {
    existing.remove()
  }

  const overlay = createVuTestOverlay()
  document.body.appendChild(overlay)

}

/**
 * Hide VU test overlay
 */
export function hideVuTestOverlay(): void {
  if (typeof window === 'undefined') {
    return
  }

  const overlay = document.getElementById('vu-test-overlay')
  if (overlay) {
    overlay.remove()
  }
}
