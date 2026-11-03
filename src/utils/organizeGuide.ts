/**
 * What the five ways to organize tasks are, side by side, for the "Which should
 * I use?" sheet.
 *
 * One list so the sentence a screen says about itself and the one the guide
 * says can't drift: the Projects empty state reads `PROJECT_DEFINITION`, and
 * the rest follow the wording of the matching tips (`tips.ts`) and empty
 * states. A category, a tag, a project, a stack and a template are different
 * answers to different questions, and nothing in the app said so before, which
 * left someone with a new idea reaching for whichever screen they opened first.
 */
import { featureHidden, type SimpleFeatureId } from './simpleMode';

/** The name of the guide, for its sheet's title and the buttons that open it. */
export const WHICH_TO_USE_LABEL = 'Which should I use?';

export type OrganizeKind = 'category' | 'tag' | 'project' | 'stack' | 'template';

export interface OrganizeGuideEntry {
  kind: OrganizeKind;
  title: string;
  /** Ionicons name, the same one the menu row for it uses. */
  icon: 'folder-outline' | 'pricetag-outline' | 'briefcase-outline' | 'layers-outline' | 'copy-outline';
  /** One or two plain sentences: what it is for and how many a task can have. */
  body: string;
  /** What someone might call one. */
  examples: string;
  /** Set where Simplified mode takes the feature away, so the guide doesn't describe it. */
  feature?: SimpleFeatureId;
}

/** What a project is, said once for the guide and the Projects empty state. */
export const PROJECT_DEFINITION = 'Work with its own page, steps and progress, like planning a trip or painting a room.';

export const ORGANIZE_GUIDE: readonly OrganizeGuideEntry[] = [
  {
    kind: 'category',
    title: 'Category',
    icon: 'folder-outline',
    body: 'The heading a task sits under on Today. A task has one.',
    examples: 'Home, Work, Errands',
  },
  {
    kind: 'tag',
    title: 'Tag',
    icon: 'pricetag-outline',
    body: 'A label you can search and filter by. A task can have several.',
    examples: 'urgent, call, online',
  },
  {
    kind: 'project',
    title: 'Project',
    icon: 'briefcase-outline',
    body: PROJECT_DEFINITION,
    examples: 'Plan the trip, Paint the kitchen',
  },
  {
    kind: 'stack',
    title: 'Stack',
    icon: 'layers-outline',
    body: 'Tasks that go together, shown under one heading on Today. Each keeps its own date.',
    examples: 'Morning routine',
    feature: 'stacks',
  },
  {
    kind: 'template',
    title: 'Template',
    icon: 'copy-outline',
    body: 'A checklist you can add again in one go.',
    examples: 'Packing list, Closing up the house',
    feature: 'templates',
  },
];

/** The guide's entries, without the ones Simplified mode has taken away. */
export function organizeGuideEntries(simpleMode: boolean): OrganizeGuideEntry[] {
  return ORGANIZE_GUIDE.filter(e => !e.feature || !featureHidden(e.feature, simpleMode));
}
