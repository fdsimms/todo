import { useCallback, useMemo, useState } from 'react';
import { haptics } from '../utils/haptics';
import { WHICH_TO_USE_LABEL } from '../utils/organizeGuide';
import type { ScreenHeaderAction } from '../components/ScreenHeader';

/**
 * What a screen needs to offer the "Which should I use?" guide: a help button
 * for its header (`action`), an `open` for an empty state's button, and the
 * props for `WhichToUseSheet`.
 *
 *   const whichToUse = useWhichToUse();
 *   <ScreenHeader actions={[whichToUse.action, ...others]} />
 *   <EmptyState secondaryActionLabel={WHICH_TO_USE_LABEL} secondaryActionIcon="help-circle-outline"
 *     onSecondaryAction={whichToUse.open} />
 *   <WhichToUseSheet {...whichToUse.sheet} />
 */
export function useWhichToUse(): {
  action: ScreenHeaderAction;
  open: () => void;
  sheet: { visible: boolean; onClose: () => void };
} {
  const [visible, setVisible] = useState(false);
  const open = useCallback(() => { haptics.tap(); setVisible(true); }, []);
  const onClose = useCallback(() => setVisible(false), []);
  const action = useMemo<ScreenHeaderAction>(
    () => ({ icon: 'help-circle-outline', onPress: open, accessibilityLabel: WHICH_TO_USE_LABEL }),
    [open],
  );
  return { action, open, sheet: { visible, onClose } };
}
