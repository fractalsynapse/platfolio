import { z } from 'zod';

// The pinned Starter Web release renders this public label directly into HTML.
// Keep the accepted alphabet free of markup and provider interpolation syntax.
export const StarterBrandChangeSchema = z.object({
  value: z.string().max(60).regex(/^[A-Za-z0-9][A-Za-z0-9 .,'()-]*$/),
}).strict();
