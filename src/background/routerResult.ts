export type RouterRejectReason =
  | 'invalid-message'
  | 'sender-url-mismatch'
  | 'sender-origin-mismatch'
  | 'sender-tab-mismatch'
  | 'scope-mismatch'
  | 'sequence-rollback';

export type RouterResult =
  | Readonly<{ accepted: true }>
  | Readonly<{ accepted: false; reason: RouterRejectReason }>;
