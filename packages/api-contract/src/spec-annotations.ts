/**
 * What the OpenAPI document knows that a StandardSchema does not (#247).
 *
 * **This file is where field prose lives.** `apps/control-plane/openapi.yaml` is generated for these
 * components by `scripts/gen-api-spec.ts`, which draws their shape from the zod definitions in
 * `packages/contracts` and their annotations from the maps below. Editing a `description:` or a `format:`
 * inside a generated component of the document is therefore a no-op that `pnpm run spec:check` will undo on
 * the next run -- change it here, and regenerate.
 *
 * WHY A SIDECAR AND NOT `.describe()` ON THE SCHEMA. The other candidate was to put the prose on the
 * definition itself, which has the obvious appeal of one file per shape. It loses on two counts, both
 * measured here:
 *
 *  - A capability contract describes what a *store row* is; this document describes what an *HTTP response*
 *    says. `Instance.state` is documented as "the rollup, not the truth" because that is what a client
 *    reading `GET /api/v1/instances/{id}` needs to know -- it is not a fact about the row. Folding the API's
 *    prose into `packages/contracts` would put a paragraph about the wire into the module the database
 *    driver imports, and would mean every consumer of the seam reads hosting commentary to find the type.
 *  - Not everything below is a description. `format: date-time` and a `pattern` the definition does not
 *    state are OpenAPI/JSON Schema keywords with no zod equivalent for a `z.string()` column, and they are
 *    enforced: `validateResponse` runs Ajv with `ajv-formats` against this document, so `format: date-time`
 *    here is a live check at the HTTP boundary, not a comment. `.describe()` could not carry any of it, so
 *    the alternative was a second sidecar beside the `.describe()` calls -- two homes for one kind of fact.
 *
 * THE RULE THE GENERATOR ENFORCES, in both directions:
 *
 *  - **The sidecar may say what the definition does not. It may never contradict it.** An annotation whose
 *    keyword the schema also emits with a different value is a refusal, naming the component and the pointer
 *    -- that is the #247 defect (one shape, two descriptions), and it is why `Instance.name` used to allow
 *    80 characters in the document and 40 in the server. Where the definition speaks, the document now says
 *    what the definition says; where it is silent, the annotation states what the API promises.
 *  - **An annotation that no longer lands is a refusal.** A pointer naming a property the generated shape
 *    does not have fails the build, so prose cannot rot into a description of a field that moved or went
 *    away. This is the same design as the drift ledger in `schema-parity.ts`, whose entries fail the build
 *    when they stop describing a real difference.
 *
 * `note` is the one entry that is not a JSON Schema keyword: it is a YAML comment emitted inside the
 * component, for maintenance prose that belongs beside the shape rather than inside the contract.
 */

/** A component's annotations. Keys after `properties` are property paths, not JSON pointers. */
export interface ComponentAnnotation {
  /** Comment lines written above the component's own keywords, in the document. */
  note?: string[];
  /** Prose for the component as a whole. */
  description?: string;
  /** Per-property annotations, keyed by dotted path (`name`, `templateRef.commitSha`, `items.updatedAt`). */
  properties?: Record<string, PropertyAnnotation>;
}

/**
 * What the document adds to one property.
 *
 * `pattern`, `maxLength` and friends are allowed here ONLY where the definition states nothing for that
 * keyword: they then become what the API promises and what Ajv enforces on a response. If the definition
 * grows the same keyword, the generator refuses until one of the two is corrected.
 */
export interface PropertyAnnotation {
  description?: string;
  format?: string;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  example?: unknown;
  deprecated?: boolean;
}

export const SPEC_ANNOTATIONS: Record<string, ComponentAnnotation> = {
  Instance: {
    properties: {
      name: {
        description: 'The half of `team/name` a person types (D45). Slug rules, enforced in the schema and the database: a name needing escapes or a disambiguating id is a name that will break in a URL, a CLI argument, or a shell.',
      },
      template: {
        description: 'The template this instance was created from. Formerly the field `platform`, which stored a template id -- D45.',
      },
      'templateRef.commitSha': {
        description: 'Pinned by commit, never by a movable tag (D30 law 3).',
      },
      state: {
        description: 'The rollup, not the truth: production\'s state when a production environment exists, otherwise the worst among the environments (#179). `InstanceResponse.environments` is what actually happened per place.',
      },
      desiredPlanHash: { pattern: '^[0-9a-f]{64}$' },
      lastAppliedPlanHash: { pattern: '^[0-9a-f]{64}$' },
      createdAt: { format: 'date-time' },
      updatedAt: { format: 'date-time' },
    },
  },

  InstanceResponse: {
    properties: {
      environments: {
        description: 'One row per environment the instance has. The assembled response always carries it; it is empty until the first reconcile.',
      },
      'environments.items.state': {
        description: 'What the controller last verified for this environment, which is the only sense in which `live` means anything (#179).',
      },
      'environments.items.updatedAt': { format: 'date-time' },
    },
  },

  Invitation: {
    properties: {
      email: {
        description: 'Normalised (trimmed and case-folded) on write.',
      },
      emailReceipt: {
        description: "The transport's receipt, so delivery is a fact about the row (D46).",
      },
      createdAt: { format: 'date-time' },
      expiresAt: { format: 'date-time' },
      acceptedAt: { format: 'date-time' },
      revokedAt: { format: 'date-time' },
    },
  },

  CapabilityOffer: {
    properties: {
      publishedAt: { format: 'date-time' },
    },
  },

  CapabilityShare: {
    properties: {
      sharedAt: { format: 'date-time' },
    },
  },

  BindingRecord: {
    properties: {
      boundAt: { format: 'date-time' },
    },
  },

  DispatchIntent: {
    note: [
      'The dispatch as the runner reads it, not the row: `nonce` and `planHash` are what the workflow carries',
      'back, and the intent expires -- `expiresAt` is enforced at the boundary, not documented.',
    ],
    properties: {
      // `AttestationSchema.nonce` is `z.string().min(16)`; the API additionally promises it is a hex token a
      // runner cannot replay after 64 characters. The definition says nothing about a maximum, so this is the
      // document speaking where the schema is silent.
      nonce: { maxLength: 64 },
      issuedAt: { format: 'date-time' },
      expiresAt: { format: 'date-time' },
    },
  },

  Attestation: {
    note: [
      'The attestation a runner reports, before it is stored. `receivedAt` and the actor appear on',
      '`AttestationRecord`, because when the control plane heard about it is a fact about this service, not',
      'a fact the runner gets to assert.',
    ],
    properties: {
      finishedAt: { format: 'date-time' },
      'release.commitSha': {
        description: 'The commit the release was built from. Seven to forty hex characters: a short SHA is a display form, a full one is an anchor.',
      },
    },
  },

  AttestationRecord: {
    note: [
      'Written out rather than composed with allOf: `additionalProperties: false` inside one allOf member',
      'rejects the fields declared only in the other member, so a correct response fails validation. The',
      'duplication is what the definition produces -- `AttestationRecordSchema` extends `AttestationSchema` --',
      'and a generated client would otherwise receive a type it cannot satisfy.',
    ],
    properties: {
      finishedAt: { format: 'date-time' },
      receivedAt: { format: 'date-time' },
      'release.commitSha': {
        description: 'The commit the release was built from. Seven to forty hex characters: a short SHA is a display form, a full one is an anchor.',
      },
    },
  },

  AuditEntry: {
    properties: {
      at: { format: 'date-time' },
      detail: {
        description: 'Structured, bounded, and never a credential: reason codes and ids, not payloads (D4).',
      },
    },
  },
};

/**
 * The components whose response shape is a composition, not a single definition.
 *
 * `Instance.environments` was the last measured drift in this repository (#247): the spec's `Instance` was
 * the assembled response while `InstanceSchema` is the stored row, because the handler builds
 * `{ ...record, environments: await store.listInstanceEnvironments(id) }`
 * (`apps/control-plane/src/capabilities.ts:257, :348`). A field added to the record to satisfy the document
 * would have made the store lie, and `InstanceSchema` is `.strict()`. So the response gets its own name,
 * built from both definitions: the record's emitted shape, plus the environment rows.
 *
 * This is a *merge of two schemas' own output*, not a hand-written field list: `properties`, `required` and
 * `additionalProperties` all come from `toJSONSchema()`, so a column added to the record arrives here
 * without an edit, and `pnpm run spec:check` fails if the document disagrees.
 */
export interface ComponentComposition {
  /** The spec component name. */
  component: string;
  /** The schema export whose emitted object shape is the base. */
  base: string;
  /** Fields the assembled response adds to the record. */
  adds: Array<{
    /** The property name the handler adds. */
    property: string;
    /** The schema export whose emitted shape becomes the array's `items`. */
    array: string;
  }>;
  /** Where the generated block goes when the document does not have it yet. */
  after: string;
}

export const COMPONENT_COMPOSITIONS: ComponentComposition[] = [
  {
    component: 'InstanceResponse',
    base: 'InstanceSchema',
    adds: [{ property: 'environments', array: 'InstanceEnvironmentStateSchema' }],
    after: 'Instance',
  },
];
