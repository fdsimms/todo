import data from '../generated/patchNotes.json';

export interface PatchNote {
  message: string;
  date: string;
}

export const patchNotes: PatchNote[] = data;
