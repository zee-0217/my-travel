// Private server memory. Never serialize tool records or raw model drafts to clients.
const contexts = new WeakMap();
export function rememberPlan(plan, context) { contexts.set(plan, context); return plan; }
export const getPlanContext = (plan) => contexts.get(plan);
