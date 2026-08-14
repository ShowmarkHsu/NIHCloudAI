import { z } from 'zod';

import { patientSnapshotV1Schema } from './patientSnapshot';
import {
  capabilityMessageSchemaVersionSchema,
  clinicalProjectionContractVersionSchema,
} from './versions';
import {
  dataSessionIdSchema,
  snapshotRevisionSchema,
} from './patientSnapshot';

const capabilitySequenceSchema = z.number().int().positive().brand<'CapabilitySequence'>();
const senderTabIdSchema = z.number().int().nonnegative().brand<'SenderTabId'>();

const capabilityMessageBaseSchema = z.object({
  schemaVersion: capabilityMessageSchemaVersionSchema,
  sessionId: dataSessionIdSchema,
  revision: snapshotRevisionSchema,
  sequence: capabilitySequenceSchema,
}).strict();

const contentDataSessionStartedMessageSchema = capabilityMessageBaseSchema.extend({
  type: z.literal('content.data-session.started'),
}).strict();

const contentDataSessionEndedMessageSchema = capabilityMessageBaseSchema.extend({
  type: z.literal('content.data-session.ended'),
}).strict();

const contentSnapshotSealedMessageSchema = capabilityMessageBaseSchema.extend({
  type: z.literal('content.snapshot.sealed'),
  snapshot: patientSnapshotV1Schema,
}).strict().superRefine((message, context) => {
  if (message.snapshot.sessionId !== message.sessionId) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'snapshot sessionId must match message sessionId', path: ['snapshot', 'sessionId'] });
  }
  if (message.snapshot.revision !== message.revision) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'snapshot revision must match message revision', path: ['snapshot', 'revision'] });
  }
});

const contentLifecycleStatusMessageSchema = capabilityMessageBaseSchema.extend({
  type: z.literal('content.lifecycle.status'),
  status: z.enum(['sources-pending', 'sources-terminal', 'session-cancelled']),
}).strict();

export const contentCapabilityMessageSchema = z.union([
  contentDataSessionStartedMessageSchema,
  contentDataSessionEndedMessageSchema,
  contentSnapshotSealedMessageSchema,
  contentLifecycleStatusMessageSchema,
]).readonly();

const iframeActiveRevisionReadMessageSchema = capabilityMessageBaseSchema.extend({
  type: z.literal('iframe.active-revision.read'),
  contractVersion: clinicalProjectionContractVersionSchema,
}).strict();

const iframeSummaryGenerateMessageSchema = capabilityMessageBaseSchema.extend({
  type: z.literal('iframe.summary.generate'),
  provider: z.enum(['ollama', 'openrouter']),
}).strict();

const iframeSummaryDiscardMessageSchema = capabilityMessageBaseSchema.extend({
  type: z.literal('iframe.summary.discard'),
}).strict();

const iframeSummaryReviewMessageSchema = capabilityMessageBaseSchema.extend({
  type: z.literal('iframe.summary.review'),
}).strict();

const iframeSummaryCopyMessageSchema = capabilityMessageBaseSchema.extend({
  type: z.literal('iframe.summary.copy'),
}).strict();

export const iframeCapabilityMessageSchema = z.discriminatedUnion('type', [
  iframeActiveRevisionReadMessageSchema,
  iframeSummaryGenerateMessageSchema,
  iframeSummaryDiscardMessageSchema,
  iframeSummaryReviewMessageSchema,
  iframeSummaryCopyMessageSchema,
]).readonly();

export const backgroundLifecycleStatusMessageSchema = capabilityMessageBaseSchema.extend({
  type: z.literal('background.lifecycle.status'),
  status: z.enum([
    'session-active',
    'snapshot-sealed',
    'generation-pending',
    'generation-unavailable',
    'generation-failed',
    'session-ended',
  ]),
}).strict().readonly();

export const capabilityMessageSchema = z.union([
  contentCapabilityMessageSchema,
  iframeCapabilityMessageSchema,
  backgroundLifecycleStatusMessageSchema,
]).readonly();

export const backgroundBoundCapabilityMessageSchema = z.object({
  senderTabId: senderTabIdSchema,
  message: z.union([
    contentCapabilityMessageSchema,
    iframeCapabilityMessageSchema,
  ]),
}).strict().readonly();

export const capabilitySequenceProgressionSchema = z.object({
  previous: capabilityMessageSchema,
  next: capabilityMessageSchema,
}).strict().superRefine((progression, context) => {
  if (progression.previous.sessionId !== progression.next.sessionId) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'sequence progression must keep the sessionId', path: ['next', 'sessionId'] });
  }
  if (progression.previous.revision !== progression.next.revision) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'sequence progression must keep the revision', path: ['next', 'revision'] });
  }
  if (progression.next.sequence <= progression.previous.sequence) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'sequence progression must be strictly increasing', path: ['next', 'sequence'] });
  }
}).readonly();

export type CapabilitySequence = z.infer<typeof capabilitySequenceSchema>;
export type SenderTabId = z.infer<typeof senderTabIdSchema>;
export type ContentCapabilityMessage = z.infer<typeof contentCapabilityMessageSchema>;
export type IframeCapabilityMessage = z.infer<typeof iframeCapabilityMessageSchema>;
export type BackgroundLifecycleStatusMessage = z.infer<typeof backgroundLifecycleStatusMessageSchema>;
export type CapabilityMessage = z.infer<typeof capabilityMessageSchema>;
export type BackgroundBoundCapabilityMessage = z.infer<typeof backgroundBoundCapabilityMessageSchema>;
export type CapabilitySequenceProgression = z.infer<typeof capabilitySequenceProgressionSchema>;
