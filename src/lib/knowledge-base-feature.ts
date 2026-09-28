/**
 * THE condition that shows the AI Knowledge Base screen.
 *
 * Blog automation generates its articles from that base, so it asks the same
 * question: both come back together when the knowledge base is switched on,
 * whether by a plan cell or by the AI Assistant add-on (which lifts
 * `aiKnowledge`). `planUnlocked` is the platform / no-tenant bypass the
 * screen already uses.
 */
export function isKnowledgeBaseEnabled(
  features: { aiKnowledge?: boolean } | null | undefined,
  planUnlocked: boolean,
): boolean {
  return planUnlocked || features?.aiKnowledge === true;
}
