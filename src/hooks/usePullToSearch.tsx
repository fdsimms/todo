import React, { useCallback, useMemo, useState } from 'react';
import { RefreshControl } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { LazySheet } from '../components/LazySheet';
import { QuickSearchModal } from '../components/QuickSearchModal';
import { useColors } from '../theme/ThemeContext';
import { haptics } from '../utils/haptics';
import { openElsewhereResult } from '../navigation/openSearchResult';
import { resetToTask } from '../navigation/navigationRef';
import type { ElsewhereResult } from '../utils/searchElsewhere';
import type { Task, TaskGroup } from '../types';

/**
 * Pull-down-to-search for any screen other than Today (which wires the same
 * gesture by hand, because its sheet opens its own editors in place).
 *
 * Spread `refreshControl` onto the screen's list and render `sheet` once
 * anywhere in the screen. A list that uses `useKeyboardInsetScroll` also
 * passes `pulling` as its `refreshing`.
 *
 * `pulling` is cleared from the sheet's `onShow`, never from a timer: the pull
 * puts iOS's UIRefreshControl into its own refreshing state and it only
 * accepts another pull after a real true→false transition of `refreshing`.
 * See the note in `handlePullToSearch` in TodayScreen before changing that.
 *
 * Where a result opens, since there is no Today editor on this screen:
 *  - a task opens its editor on Today (`resetToTask`);
 *  - a stack, which has no page of its own, hands its name to the Search screen;
 *  - a project, person, recipe, grocery item, screen or setting opens exactly
 *    where it does from Today (`openElsewhereResult`).
 */
export function usePullToSearch() {
  const colors = useColors();
  const navigation = useNavigation<any>();
  const [pulling, setPulling] = useState(false);
  const [visible, setVisible] = useState(false);

  const onRefresh = useCallback(() => {
    setPulling(true);
    haptics.impactLight();
    setVisible(true);
  }, []);
  const endPull = useCallback(() => setPulling(false), []);
  const close = useCallback(() => {
    setVisible(false);
    setPulling(false);
  }, []);

  const openFullSearch = useCallback((query: string) => {
    navigation.navigate({ name: 'Search', params: { query, at: Date.now() } });
  }, [navigation]);
  const selectTask = useCallback((task: Task) => resetToTask(task.id), []);
  const selectGroup = useCallback((group: TaskGroup) => openFullSearch(group.title), [openFullSearch]);
  const selectProject = useCallback((projectId: string) => {
    navigation.navigate({ name: 'ProjectDetail', params: { projectId } });
  }, [navigation]);
  const selectElsewhere = useCallback((result: ElsewhereResult) => {
    openElsewhereResult(navigation, result);
  }, [navigation]);

  const refreshControl = useMemo(() => (
    <RefreshControl
      refreshing={pulling}
      onRefresh={onRefresh}
      tintColor={colors.textSecondary}
    />
  ), [pulling, onRefresh, colors.textSecondary]);

  const sheet = (
    <LazySheet open={visible}>
      <QuickSearchModal
        visible={visible}
        onClose={close}
        onShown={endPull}
        onSelectTask={selectTask}
        onSelectGroup={selectGroup}
        onSelectProject={selectProject}
        onSelectElsewhere={selectElsewhere}
        onOpenFullSearch={openFullSearch}
      />
    </LazySheet>
  );

  return { pulling, refreshControl, sheet };
}
