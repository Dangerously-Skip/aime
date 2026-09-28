'use client'

import { ProviderManager } from './provider-manager'
import { TierGrid } from './tier-grid'
import { ImageModelChooser } from './image-model-chooser'

/**
 * Settings → Models & API keys. In this order:
 *
 *  1. ProviderManager — every way to reach a model, Anthropic included
 *  2. The tier grid (which model fills each tier)
 *  3. The image model
 *
 * There used to be a separate "Anthropic API Key" card above the list as well
 * as an Anthropic preset inside it; onboarding wrote both. Two places for one
 * key meant two answers to "is it set", and the card saved whatever was typed
 * without checking it. The list is the one place now, and adding Anthropic
 * there scans `/v1/models` with the key first — a typo fails before anything
 * is stored.
 *
 * The section id stays `connectors`: `openSettings('connectors')` is how an
 * error card sends someone here to fix their key.
 */
export function ConnectorsSection() {
  return (
    <div className="space-y-6">
      <ProviderManager />
      <TierGrid />
      <ImageModelChooser />
    </div>
  )
}
