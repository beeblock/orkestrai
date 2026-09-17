export const VIDEO_CONFIG_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    modelId: { type: 'string', maxLength: 240, description: 'Exact endpoint ID from video_workflow_models; legacy wan-2.7-text and kling-v3-pro-image remain supported.' },
    parameters: { type: 'object', description: 'Provider input following the selected model contract, including nested arrays/objects. No credentials or inline base64. prompt may instead be configured in the top-level prompt field.' },
    mediaBindings: { type: 'array', maxItems: 50, items: { type: 'object', additionalProperties: false, properties: { pointer: { type: 'string', description: 'JSON pointer into parameters, e.g. /image_urls/0 or /elements/0/frontal_image_url.' }, nodeId: { type: 'string', format: 'uuid' }, path: { type: 'string', description: 'Workspace-relative image, audio or video path. Supply exactly one of nodeId and path.' } }, required: ['pointer'] } },
    billingUnits: { type: ['number', 'null'], exclusiveMinimum: 0, maximum: 1000000000, description: 'Explicit estimated billing quantity for units not derivable from the model input. Does not cap the provider invoice.' },
    profileId: { type: ['string', 'null'], format: 'uuid' },
    prompt: { type: 'string', maxLength: 50000 }, negativePrompt: { type: 'string', maxLength: 2500 },
    duration: { type: 'integer', minimum: 2, maximum: 15 },
    aspectRatio: { type: 'string', enum: ['16:9', '9:16', '1:1', '4:3', '3:4'] },
    resolution: { type: 'string', enum: ['720p', '1080p'] }, generateAudio: { type: 'boolean' },
    seed: { type: ['integer', 'null'], minimum: 0, maximum: 2147483647 },
    startImageNodeId: { type: ['string', 'null'], format: 'uuid' }, endImageNodeId: { type: ['string', 'null'], format: 'uuid' },
    contextNodeIds: { type: 'array', maxItems: 8, uniqueItems: true, items: { type: 'string', format: 'uuid' } },
    outputDirectory: { type: 'string', maxLength: 500 }, filePrefix: { type: 'string', maxLength: 80 },
  },
};
export const VIDEO_TOOL_DESCRIPTIONS = {
  models: 'Discover ALL published fal.ai video endpoints with query/offset/limit. With input.endpoint, return the exact current input/output schema and digest. Select exact IDs, not guessed names. Deprecated endpoints cannot generate. Read the contract before create/update; configure parameters and mediaBindings. Availability in the catalog is not account authorization.',
  list: 'Discover native video workflows, allowed account IDs, model capabilities and image/video/note node IDs. No credentials are returned.',
  read: 'Read the video workflow revision, config, history and persisted output path. queued is not completed. Poll at most once every 15 seconds while running.',
  create: 'Create a native videoWorkflow node without generating or charging. Discover models and read their exact contract first using video_workflow_models. Configure parameters for the selected endpoint and bind workspace images/videos/audio with mediaBindings. Use allowed profiles from list. No API key belongs in input.',
  update: 'Replace video workflow title/config using its current revision, without starting generation. For an unsaved draft returned by list/read, omit revision on the first save; persisted workflows require their exact revision. Explicit note/image IDs bind inputs; ordinary agent communication edges do not execute branches.',
  preview: 'Validate current references and estimate fal.ai cost without generating. Return preview ID/revision and 4x base reservation; this is not a guaranteed billing cap. Owner policy and paid-operation gates still apply.',
  run: 'Submit exactly the approved preview/revision once with a stable UUID idempotencyKey. Requires owner-enabled account/model/agent/egress permissions and budget. Queue persists across restarts. Never replace a key after an uncertain submission.',
  cancel: 'Request cancellation of your own run. Requested does not mean cancelled or refunded. A result may finish first.',
  retry_download: 'Retrieve the already-generated result of your own failed download, without regenerating or paying for a second generation.',
  remove: 'Remove an inactive video workflow node. Active or uncertain paid runs block deletion. Generated workspace files are preserved.',
};
