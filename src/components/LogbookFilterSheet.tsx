import React, { useMemo } from 'react';
import { ChipFilterSheet, type ChipFilterGroup, type ChipFilterOption } from './ChipFilterSheet';

export type LogbookFilterOption = ChipFilterOption;

interface Props {
  visible: boolean;
  onClose: () => void;
  categories: LogbookFilterOption[];
  tags: LogbookFilterOption[];
  selectedCategory: string | null;
  onSelectCategory: (key: string | null) => void;
  selectedTag: string | null;
  onSelectTag: (key: string | null) => void;
  /** Empty when nobody has been added, which hides the section entirely. */
  people: LogbookFilterOption[];
  selectedPerson: string | null;
  onSelectPerson: (key: string | null) => void;
  /** The projects anything in the logbook is filed under; empty hides the section. */
  projects: LogbookFilterOption[];
  selectedProject: string | null;
  onSelectProject: (key: string | null) => void;
}

/**
 * The Logbook's category, tag, person and project filters, in `ChipFilterSheet`.
 * They used to be horizontal chip rows pinned under the search bar, which cost
 * ~90pt of the list and hid every option past the third one off the right edge;
 * here the chips wrap, so the whole set is visible at once.
 *
 * Each group is a single choice with an "All" chip, and tapping the picked chip
 * again clears it. A group with no options drops out of the sheet, which is how
 * the people layer stays invisible until somebody has been added.
 */
export function LogbookFilterSheet({
  visible, onClose, categories, tags, selectedCategory, onSelectCategory, selectedTag, onSelectTag,
  people, selectedPerson, onSelectPerson, projects, selectedProject, onSelectProject,
}: Props) {
  const groups = useMemo<ChipFilterGroup[]>(() => {
    const single = (
      label: string,
      options: LogbookFilterOption[],
      selected: string | null,
      onSelect: (key: string | null) => void,
    ): ChipFilterGroup => ({
      label,
      options,
      selected: selected ? [selected] : [],
      showAllChip: true,
      onClear: () => onSelect(null),
      onToggle: key => onSelect(selected === key ? null : key),
    });
    // Project first: a project's history is the question the project page
    // sends people here with.
    return [
      single('Project', projects, selectedProject, onSelectProject),
      single('Category', categories, selectedCategory, onSelectCategory),
      single('Tag', tags, selectedTag, onSelectTag),
      single('Person', people, selectedPerson, onSelectPerson),
    ];
  }, [
    categories, tags, people, projects,
    selectedCategory, selectedTag, selectedPerson, selectedProject,
    onSelectCategory, onSelectTag, onSelectPerson, onSelectProject,
  ]);

  const clearAll = () => {
    onSelectCategory(null);
    onSelectTag(null);
    onSelectPerson(null);
    onSelectProject(null);
  };

  return <ChipFilterSheet visible={visible} onClose={onClose} groups={groups} onClearAll={clearAll} />;
}
