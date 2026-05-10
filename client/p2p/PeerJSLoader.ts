/**
 * PeerJS Loader
 *
 * Loads PeerJS on demand.
 * Avoids import issues on the client.
 */

import { logPeerJSLoading, logPeerJSLoaded } from './P2PLogger'

let peerjsModule: any = null
let loadPromise: Promise<any> | null = null
let hasLogged = false

export async function loadPeerJS(): Promise<any> {
  if (peerjsModule) {
    return peerjsModule
  }

  if (loadPromise) {
    return loadPromise
  }

  if (!hasLogged) {
    logPeerJSLoading()
    hasLogged = true
  }

  loadPromise = (async () => {
    // Try to import PeerJS
    peerjsModule = await import('peerjs')
    logPeerJSLoaded()
    return peerjsModule
  })()

  return loadPromise
}

export function getPeerJS() {
  return peerjsModule
}

export function isPeerJSLoaded(): boolean {
  return peerjsModule !== null
}
