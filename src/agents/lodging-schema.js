import { objectSchema } from './tool-schemas.js';

const placeRef = objectSchema({ callId: { type: 'string', minLength: 1, maxLength: 200 }, index: { type: 'integer', minimum: 0, maximum: 4 } });
export const lodgingSchema = (duration) => ({ type: 'array', maxItems: 3, items: objectSchema({
  placeRef,
  nightIndexes: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'integer', minimum: 0, maximum: Math.max(0, duration - 2) } },
  reason: { type: 'string', minLength: 1, maxLength: 350 },
  webSourceUrls: { type: 'array', maxItems: 3, items: { type: 'string', minLength: 1, maxLength: 1500 } },
}) });
