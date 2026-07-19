export type ObsidianConsentPreview = {
  planId: string
  planHash: string
  vaultDisplayName: string
  workspaceId: string
  counts: {
    notes: number
    templates: number
    canvases: number
    attachments: number
    customGroups: number
  }
  policies: {
    hierarchy: 'spaces' | 'parents' | 'flatten'
    collisions: 'rename' | 'skip' | 'fail'
    attachments: 'referenced' | 'skip'
    unsupported: 'preserve' | 'skip'
  }
  acceptedGroupCount: number
}

export type ObsidianConsentResponse = {
  action: 'accept' | 'decline' | 'cancel'
  content?: Record<string, unknown>
}

export type ObsidianConsentDecision =
  | { outcome: 'accepted'; source: 'tool_input' | 'elicitation' }
  | { outcome: 'confirmation_required'; source: 'compatibility_fallback' }
  | { outcome: 'declined' | 'cancelled' | 'adjustment_required'; source: 'tool_input' | 'elicitation' }

export type ObsidianConsentRequest = (preview: ObsidianConsentPreview) => Promise<ObsidianConsentResponse>

export function buildObsidianConsentElicitation(preview: ObsidianConsentPreview): ElicitRequestFormParams {
  return {
    mode: 'form',
    message: [
      `Import Obsidian plan ${preview.planId} (${preview.planHash}) from ${preview.vaultDisplayName} into workspace ${preview.workspaceId}?`,
      `${preview.counts.customGroups} custom types, ${preview.counts.templates} templates, ${preview.counts.notes} notes, ${preview.counts.canvases} Canvas files, and ${preview.counts.attachments} referenced attachments are planned.`,
      `Policies: hierarchy=${preview.policies.hierarchy}, collisions=${preview.policies.collisions}, attachments=${preview.policies.attachments}, unsupported=${preview.policies.unsupported}.`,
      'The source vault will remain read-only. AuroraDocs writes are additive and run as one resumable bounded batch.',
    ].join('\n'),
    requestedSchema: {
      type: 'object',
      properties: {
        hierarchy_policy: { type: 'string', title: 'Hierarchy', enum: ['spaces', 'parents', 'flatten'], default: preview.policies.hierarchy },
        collision_policy: { type: 'string', title: 'Type collisions', enum: ['rename', 'skip', 'fail'], default: preview.policies.collisions },
        attachment_policy: { type: 'string', title: 'Attachments', enum: ['referenced', 'skip'], default: preview.policies.attachments },
        unsupported_policy: { type: 'string', title: 'Unsupported items', enum: ['preserve', 'skip'], default: preview.policies.unsupported },
        include_inferred_groups: { type: 'boolean', title: 'Use approved inferred groups', default: preview.acceptedGroupCount > 0 },
        confirmed: { type: 'boolean', title: 'Approve this exact import plan', default: false },
      },
      required: [
        'hierarchy_policy', 'collision_policy', 'attachment_policy',
        'unsupported_policy', 'include_inferred_groups', 'confirmed',
      ],
    },
  }
}

function choicesMatch(preview: ObsidianConsentPreview, content: Record<string, unknown>): boolean {
  return content['hierarchy_policy'] === preview.policies.hierarchy
    && content['collision_policy'] === preview.policies.collisions
    && content['attachment_policy'] === preview.policies.attachments
    && content['unsupported_policy'] === preview.policies.unsupported
    && content['include_inferred_groups'] === (preview.acceptedGroupCount > 0)
}

export async function decideObsidianImportConsent(input: {
  confirmed?: unknown
  preview: ObsidianConsentPreview
  requestConsent?: ObsidianConsentRequest
}): Promise<ObsidianConsentDecision> {
  if (!input.requestConsent) {
    if (input.confirmed === true) return { outcome: 'accepted', source: 'tool_input' }
    if (input.confirmed === false) return { outcome: 'declined', source: 'tool_input' }
    return { outcome: 'confirmation_required', source: 'compatibility_fallback' }
  }

  let response: ObsidianConsentResponse
  try {
    response = await input.requestConsent(input.preview)
  } catch {
    return { outcome: 'cancelled', source: 'elicitation' }
  }
  if (response.action === 'decline') return { outcome: 'declined', source: 'elicitation' }
  if (response.action === 'cancel') return { outcome: 'cancelled', source: 'elicitation' }
  if (!response.content || response.content['confirmed'] !== true) {
    return { outcome: 'declined', source: 'elicitation' }
  }
  if (!choicesMatch(input.preview, response.content)) {
    return { outcome: 'adjustment_required', source: 'elicitation' }
  }
  return { outcome: 'accepted', source: 'elicitation' }
}
import type { ElicitRequestFormParams } from '@modelcontextprotocol/sdk/types.js'
