import React from 'react';
import type { DeliverableKind } from '../types';
import { DELIVERABLE_META } from '../utils/deliverables';
import { SegmentedControl } from './SegmentedControl';

interface Props {
  value: DeliverableKind | null;
  /** Called with the picked kind, or null for "Nothing". */
  onChange: (kind: DeliverableKind | null) => void;
}

/**
 * The "Ask on completion" picker — Nothing / Text / Date / Number.
 *
 * Shared because a template item declares the same question a task does
 * (#1471): both editors show one control over one `DELIVERABLE_META`, so
 * neither can end up offering a kind the other doesn't. The row it sits in
 * stays with the caller — the two editors word their hints and summaries
 * themselves, and TaskEditor's row also collapses its field on a pick.
 *
 * A `SegmentedControl` rather than the wrapping pill row it started as: the
 * set is closed and exactly one is chosen, which is the rule that component's
 * doc comment gives for the track over free-width pills.
 */
export function DeliverableKindPicker({ value, onChange }: Props) {
  return (
    <SegmentedControl<DeliverableKind | null>
      options={[
        { value: null, label: 'Nothing' },
        ...DELIVERABLE_META.map(meta => ({
          value: meta.key,
          label: meta.label,
          icon: meta.icon,
          accessibilityLabel: `${meta.label}. ${meta.hint}`,
        })),
      ]}
      value={value}
      onChange={onChange}
    />
  );
}
