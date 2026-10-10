/**
 * Where a lead goes once it is written.
 *
 * Pure decision logic, no I/O, so it can be tested exhaustively without a
 * database or a mail server.
 */
export type Destination = 'designers' | 'escalation' | 'none'

export interface RoutableLead {
  result: string
  service_area: string
  pricing_leaked?: boolean | null
  needs_review?: boolean | null
}

export interface RoutingDecision {
  destination: Destination
  /** Escalations carry no Claim button: nobody "claims" a problem call. */
  claimable: boolean
  reason: string
  /** Independent of the handoff - a leak is an incident, not a routing choice. */
  pricingIncident: boolean
}

export function routeLead(lead: RoutableLead): RoutingDecision {
  const pricingIncident = Boolean(lead.pricing_leaked)

  if (lead.result === 'escalated') {
    return {
      destination: 'escalation', claimable: false,
      reason: 'agent_escalated', pricingIncident,
    }
  }

  if (lead.result === 'qualified') {
    return {
      destination: 'designers', claimable: true,
      reason: 'qualified', pricingIncident,
    }
  }

  if (lead.result === 'declined') {
    // A decline the agent made on an unknown locality is a decline we do not
    // trust. The gate said "I don't know", and acting on "I don't know" as if
    // it were "no" is how a Kothrud project gets turned away over a bad line.
    if (lead.service_area === 'unknown') {
      return {
        destination: 'escalation', claimable: false,
        reason: 'declined_on_unknown_locality', pricingIncident,
      }
    }
    return {
      destination: 'none', claimable: false,
      reason: 'declined', pricingIncident,
    }
  }

  // incomplete: the caller hung up partway. If anything was captured it is
  // worth a callback; an empty incomplete call is noise.
  if (lead.result === 'incomplete') {
    if (lead.needs_review) {
      return {
        destination: 'escalation', claimable: false,
        reason: 'incomplete_needs_review', pricingIncident,
      }
    }
    return { destination: 'none', claimable: false, reason: 'incomplete', pricingIncident }
  }

  // An unrecognised result is not a reason to drop a lead on the floor.
  return {
    destination: 'escalation', claimable: false,
    reason: 'unrecognised_result', pricingIncident,
  }
}
