import React, { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { useTaskStore } from '../store/useTaskStore';
import { useProjectStore } from '../store/useProjectStore';
import { useSheetMount } from '../hooks/useSheetMount';
import { WhenPicker } from './WhenPicker';
import { awayNoonIso } from '../utils/awayDates';
import { formatDeadlineDate, getDayStart } from '../utils/dateUtils';
import { haptics } from '../utils/haptics';

/**
 * The two questions a "Pick dates" answer raises about its trip
 * (`useTaskStore.tripDatePrompt`, see `Task.deliverableSetsAway`):
 *
 * - **Coming back**, right after the answer filled an empty Leaving date. The
 *   question was about the trip's dates, and a trip with one end is half
 *   answered. Cancel leaves it open-ended, as it was.
 * - **Move Leaving?**, when a trip already has a Leaving date and the answer
 *   (a re-answer, or an edit in the Logbook) names another day. Offered, not
 *   done: the date there is one somebody set.
 *
 * Mounted once at the navigator root beside UndoBar: the answer can be given
 * from anywhere a task can be completed.
 */
export function TripDatePrompt() {
  const prompt = useTaskStore(s => s.tripDatePrompt);
  const clear = useTaskStore(s => s.clearTripDatePrompt);
  const project = useProjectStore(s => (prompt ? s.projects.find(p => p.id === prompt.projectId) ?? null : null));
  const askedAtRef = useRef(0);

  useEffect(() => {
    if (!prompt || prompt.kind !== 'moveLeaving' || prompt.at === askedAtRef.current) return;
    askedAtRef.current = prompt.at;
    if (!project?.awayStart) { clear(); return; }
    const to = formatDeadlineDate(prompt.awayStart);
    Alert.alert(
      'Move the leaving date?',
      `You answered ${to}. ${project.title} is set to leave ${formatDeadlineDate(project.awayStart)}.`,
      [
        { text: 'Keep it', style: 'cancel', onPress: clear },
        {
          text: `Move to ${to}`,
          onPress: () => {
            haptics.success();
            useProjectStore.getState().updateProject(prompt.projectId, { awayStart: prompt.awayStart });
            clear();
          },
        },
      ],
      { cancelable: true, onDismiss: clear },
    );
  }, [prompt?.at]);

  const askingReturn = prompt?.kind === 'return' && !!project?.awayStart && !project.awayEnd;
  const mountPicker = useSheetMount(askingReturn);
  if (!mountPicker) return null;

  return (
    <WhenPicker
      visible={askingReturn}
      value={null}
      title={project ? `Coming back from ${project.title}` : 'Coming back'}
      showTimeOfDay={false}
      showSuggest={false}
      allowPast={false}
      onConfirm={date => {
        // A day before leaving isn't a shorter trip, and awaySpanOf would drop
        // it anyway; the question just goes unanswered.
        if (date && project?.awayStart && getDayStart(date) >= getDayStart(new Date(project.awayStart))) {
          haptics.success();
          useProjectStore.getState().updateProject(project.id, { awayEnd: awayNoonIso(date) });
        }
        clear();
      }}
      onCancel={clear}
    />
  );
}
