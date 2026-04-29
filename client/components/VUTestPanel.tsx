/**
 * VU Test Panel - Development tool for testing VU system
 *
 * Shows real-time VU metrics and allows testing different viewport sizes
 */

import { useState, useEffect } from 'react'
import { getViewportInfo, vuToPx, runVuTests } from '@/utils/vuTesting'

interface VUTestPanelProps {
  enabled?: boolean
  onRunTests?: () => void
}

export function VUTestPanel({ enabled = true, onRunTests }: VUTestPanelProps) {
  const [viewportInfo, setViewportInfo] = useState(getViewportInfo())
  const [testResults, setTestResults] = useState<{ pass: boolean; results: Array<any> } | null>(null)
  const [showDetails, setShowDetails] = useState(false)

  useEffect(() => {
    if (!enabled) {
      return
    }

    const handleResize = () => {
      setViewportInfo(getViewportInfo())
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [enabled])

  if (!enabled) {
    return null
  }

  const handleRunTests = () => {
    const results = runVuTests()
    setTestResults(results)
    onRunTests?.()
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 10,
        right: 10,
        background: 'rgba(0, 0, 0, 0.95)',
        color: '#0f0',
        fontFamily: 'monospace',
        fontSize: '11px',
        padding: '12px',
        borderRadius: '6px',
        zIndex: 999999,
        minWidth: '280px',
        maxHeight: '80vh',
        overflowY: 'auto',
        border: '1px solid #0f0',
        boxShadow: '0 0 10px rgba(0, 255, 0, 0.3)',
      }}
    >
      <div style={{ fontWeight: 'bold', marginBottom: 10, fontSize: '12px' }}>
        🔍 VU System Debug Panel
      </div>

      {/* Viewport Info */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontWeight: 'bold', marginBottom: 5 }}>Viewport:</div>
        <div>Width: {viewportInfo.width}px</div>
        <div>Height: {viewportInfo.height}px</div>
        <div>Aspect: {viewportInfo.aspectRatio.toFixed(2)}</div>
        <div>DPR: {viewportInfo.devicePixelRatio}</div>
      </div>

      {/* VU Base */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontWeight: 'bold', marginBottom: 5 }}>VU Base:</div>
        <div style={{ color: '#0ff' }}>
          1 VU = {viewportInfo.vuBase.toFixed(3)}px
        </div>
        <div style={{ fontSize: '10px', opacity: 0.8 }}>
          ({viewportInfo.height} × 0.001)
        </div>
      </div>

      {/* Common VU Values */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontWeight: 'bold', marginBottom: 5 }}>Common Values:</div>
        <div>1 VU = {viewportInfo.vuBase.toFixed(2)}px</div>
        <div>10 VU = {vuToPx(10).toFixed(1)}px</div>
        <div>50 VU = {vuToPx(50).toFixed(1)}px</div>
        <div>100 VU = {vuToPx(100).toFixed(1)}px</div>
        <div>118 VU (Card) = {vuToPx(118).toFixed(1)}px</div>
        <div>300 VU = {vuToPx(300).toFixed(1)}px</div>
      </div>

      {/* Test Results */}
      {testResults && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontWeight: 'bold', marginBottom: 5 }}>
            Test Results: {testResults.pass ? '✅ PASSED' : '❌ FAILED'}
          </div>
          <div style={{ maxHeight: '150px', overflowY: 'auto' }}>
            {testResults.results.map((result, idx) => (
              <div key={idx} style={{ marginBottom: 3 }}>
                <span style={{ color: result.pass ? '#0f0' : '#f00' }}>
                  {result.pass ? '✅' : '❌'}
                </span>
                <span style={{ marginLeft: 5 }}>{result.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 5, marginTop: 10 }}>
        <button
          onClick={handleRunTests}
          style={{
            background: '#0f0',
            color: '#000',
            border: 'none',
            padding: '5px 10px',
            borderRadius: '3px',
            cursor: 'pointer',
            fontSize: '10px',
            fontWeight: 'bold',
          }}
        >
          Run Tests
        </button>
        <button
          onClick={() => setShowDetails(!showDetails)}
          style={{
            background: '#00f',
            color: '#fff',
            border: 'none',
            padding: '5px 10px',
            borderRadius: '3px',
            cursor: 'pointer',
            fontSize: '10px',
          }}
        >
          {showDetails ? 'Hide' : 'Show'} Details
        </button>
      </div>

      {/* Detailed Info */}
      {showDetails && (
        <div style={{ marginTop: 10, padding: 8, background: 'rgba(255,255,255,0.1)', borderRadius: 3 }}>
          <div style={{ fontWeight: 'bold', marginBottom: 5 }}>CSS Variables:</div>
          <div style={{ fontSize: '9px', maxHeight: '200px', overflowY: 'auto' }}>
            {(() => {
              if (typeof window === 'undefined') {
                return 'Server-side'
              }
              const root = document.documentElement
              const styles = getComputedStyle(root)
              const vars: string[] = []
              for (let i = 0; i < styles.length; i++) {
                const prop = styles[i]
                if (prop.startsWith('--vu')) {
                  vars.push(`${prop}: ${styles.getPropertyValue(prop)}`)
                }
              }
              return vars.map((v, i) => <div key={i}>{v}</div>)
            })()}
          </div>
        </div>
      )}

      {/* Preset Buttons */}
      <div style={{ marginTop: 10 }}>
        <div style={{ fontWeight: 'bold', marginBottom: 5 }}>Test Viewports:</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {[
            { label: '720p', w: 1280, h: 720 },
            { label: '1080p', w: 1920, h: 1080 },
            { label: '1440p', w: 2560, h: 1440 },
          ].map((preset) => (
            <button
              key={preset.label}
              onClick={() => {
                if (typeof window !== 'undefined') {
                  window.resizeTo(preset.w, preset.h)
                }
              }}
              style={{
                background: '#333',
                color: '#fff',
                border: '1px solid #666',
                padding: '3px 6px',
                borderRadius: '2px',
                cursor: 'pointer',
                fontSize: '9px',
              }}
              title={`Resize to ${preset.w}×${preset.h}`}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div style={{ fontSize: '9px', marginTop: 3, opacity: 0.7 }}>
          *May be blocked by browser security
        </div>
      </div>

      {/* Close Button */}
      <button
        onClick={() => {
          if (typeof window !== 'undefined') {
            const overlay = document.getElementById('vu-test-overlay')
            if (overlay) {
              overlay.remove()
            }
          }
        }}
        style={{
          position: 'absolute',
          top: 5,
          right: 5,
          background: '#f00',
          color: '#fff',
          border: 'none',
          width: '16px',
          height: '16px',
          borderRadius: '50%',
          cursor: 'pointer',
          fontSize: '10px',
          lineHeight: '16px',
          textAlign: 'center',
        }}
      >
        ×
      </button>
    </div>
  )
}

/**
 * Hook to enable VU test panel in development
 */
export function useVUTestPanel(enable: boolean = true) {
  useEffect(() => {
    if (!enable || import.meta.env.PROD) {
      return
    }

    // Create container for test panel
    const container = document.createElement('div')
    container.id = 'vu-test-panel-container'
    document.body.appendChild(container)

    // Mount test panel
    import('./VUTestPanel').then(({ VUTestPanel }) => {
      import('react-dom/client').then(({ createRoot }) => {
        const root = createRoot(container)
        root.render(<VUTestPanel enabled />)
      })
    })

    return () => {
      container.remove()
    }
  }, [enable])
}
