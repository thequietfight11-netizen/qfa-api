# The Quiet Fight — App improvements (staged, NOT deployed)

## What's already coded
- app-v2/journey.mjs: 100 self-paced days, no one-day-per-day limit, revisits, next-day choice, six short optional activities.
- app-v2/co-parenting.mjs: calm reply composer, handover prep, changed plans and no-contact support options.
- app-v2/analytics.mjs: consent-gated, allowlisted non-text events, latency bands, privacy-preserving group summaries and safe aggregate CSV output.
- app-v2/analytics-schema.sql: example storage schema with opt-in preferences, delete-on-withdrawal and 90-day retention.
- app-v2/features.test.mjs: automated tests in CI.

## UX, not a redesign
Keep the existing dark interface, layout, navigation and rounded cards. Use the approved matte gold TQF logo only once the owner-supplied asset is integrated. No wallpaper of extra images.

**Q:** Label it 'Q — AI support companion', with starters: 'I'm missing my kids today', 'I'm struggling with dad guilt', 'I just need someone to listen'. Retain the thinking indicator. Do not promise the chat is 100% private without verifying backend data handling.

**Journey:** After completing day N, show: 'Day N complete. Want to keep going?' Choices: Continue to day N+1 / Try something different / That's enough for today. Save progress and allow revisits; do not use shame-based streaks or reset progress. Keep the 100-day structure, but don't force a calendar wait. Optional activities are independently completable.

**Co-parenting:** Offer a pause-before-reply tool, unsent drafting, handover checklist, plans-changed help and a no-contact option. No automatic messages, no legal predictions, and no encouragement to breach orders.

**Pricing:** Preserve £2.99 per month after a three-day trial as the owner's proposed offer. Check actual Google Play Billing settings, purchase entitlement, trial eligibility and cancellation disclosures before changing or advertising the offer.

## Analytics design
Do not track message text, journal text, child details, location, raw device IDs, phone numbers, or social graph. Count allowed events only after a verified server-side opt-in. Do not accept browser-only consent booleans. Keep 90 days of event data, then delete. Allow opting out, withdrawing consent and deletion. No user-level access for the founder: only aggregates with at least five distinct people per reported segment.

### Weekly metrics and definitions
| Metric | Meaning |
| --- | --- |
| Weekly engaged users | Distinct consenting users who opened the app this week |
| First-day completion | People who completed journey day one / those who opened day one |
| Same-day multi-day use | People who completed at least two different days on a calendar date |
| Day N drop-off | People who opened day N but didn't complete it within seven days |
| Optional-activity use | People choosing quick activities / active journey users |
| Co-parent use | People opening each practical tool, with safe aggregation |
| Q reliability | Success/error counts and response-time categories; no message content |
| 7/28-day return | People who open again 7 or 28 days after first usage |
| Privacy guardrails | Consent withdrawals, denied events, deletion checks |
| Trial conversion | Verified billing-provider data once billing is configured |

These are product-engagement proxies, not proof of emotional improvement. Avoid collecting raw mood labels or distress scores for admin analysis.

## Deployment gates
1. Reconnect the owner AppDeploy account. The active Android TWA loads the hosted AppDeploy app, NOT this GitHub repo. Its source, auth, progress schema and existing users must be inspected before integration.
2. Protect saved user journey state with a backwards-compatible migration and atomic updates.
3. Complete a DPIA for sensitive analytics; update privacy policy, consent controls and Google Play Data Safety disclosures.
4. Build an authenticated collector, server-derived pseudonymous IDs, rate limits, consent enforcement, export/deletion and role-restricted admin read endpoints.
5. Deploy a private aggregated dashboard using verified live data and permit ChatGPT access only to reviewed aggregate exports through an authorised connector.
6. Re-test browser and Android TWA, Q, existing user login, billing and accessibility with existing testers before public rollout.

## Evidence used
- Cafcass parent communication guidance: https://www.cafcass.gov.uk/parent-carer-or-family-member/my-family-involved-private-law-proceedings/resources-help-you-make-arrangements-are-your-childs-best-interests/communicating-your-childs-other-parent-during-separation
- Flexible digital parenting modules: https://pmc.ncbi.nlm.nih.gov/articles/PMC9744042/
- Google Play sensitive data policy: https://support.google.com/googleplay/android-developer/answer/10144311
- ICO consent: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/a-guide-to-lawful-basis/consent/
- ICO DPIA guidance: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/data-protection-impact-assessments-dpias/when-do-we-need-to-do-a-dpia/

## Test
node --test app-v2/features.test.mjs
Tests are local with no real user data, billing or paid AI requests.