export enum LabelStatus {
  NOT_READY = 'NOT_READY',
  READY = 'READY',
  PRINTED = 'PRINTED',
  REPRINTED = 'REPRINTED',
}

export const LABEL_STATUSES = Object.values(LabelStatus);