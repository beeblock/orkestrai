export const AUDIO_WORKFLOW_DRAFT = {
  modality: 'audio', provider: 'fal', modelId: 'fal-ai/elevenlabs/music',
  parameters: { music_length_ms: 30000, output_format: 'mp3_44100_128' },
  outputDirectory: 'generated/audio', filePrefix: 'orkestrai-audio',
} as const;
