// Private server context. Never expose plaintext tool records or raw drafts.
// Vercel's database-free mode transfers only authenticated, encrypted session tokens.
const contexts = new WeakMap();
export function rememberPlan(plan, context) { contexts.set(plan, context); return plan; }
export const getPlanContext = (plan) => contexts.get(plan);
