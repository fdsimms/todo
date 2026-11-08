import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useYnabStore } from '../../store/useYnabStore';
import { useColors } from '../../theme/ThemeContext';
import { formatPrice } from '../../utils/groceryPrice';
import { haptics } from '../../utils/haptics';
import { animateLayout } from '../../utils/layoutAnimation';
import { ynabCategoryNow, ynabPickableCategories } from '../../utils/ynabPlan';
import { SettingsSection } from './SettingsSection';
import { SettingsRow } from './SettingsRow';
import { SettingsChoiceTray } from './SettingsChoiceTray';
import { YnabAccountRows } from './YnabAccountRows';
import { makeSettingsStyles } from './settingsStyles';

/**
 * Kitchen's YNAB section: the shopping trip's budget taken from a YNAB
 * category's balance this month (`ynabGroceryBudget`, read by
 * `ActiveTripBanner`), with the token, the plan and the category it reads.
 * The token and plan rows are the same component Automations shows under the
 * YNAB task, so the two features share one account.
 */
export function YnabGroceryBudgetSection(): React.ReactElement {
  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);
  const on = useSettingsStore(s => s.ynabGroceryBudget);
  const setOn = useSettingsStore(s => s.setYnabGroceryBudget);
  const planId = useSettingsStore(s => s.ynabPlanId);
  const categoryId = useSettingsStore(s => s.ynabGroceryCategoryId);
  const setCategoryId = useSettingsStore(s => s.setYnabGroceryCategoryId);
  const currencySymbol = useSettingsStore(s => s.currencySymbol);
  const hasToken = useYnabStore(s => s.hasToken);
  const snapshot = useYnabStore(s => s.snapshot);
  const [pickerOpen, setPickerOpen] = useState(false);

  // The category list comes from a read of the chosen plan.
  const ready = hasToken && planId !== null;
  const categories = ynabPickableCategories(snapshot);
  const chosen = ynabCategoryNow(snapshot, categoryId, new Date());

  return (
    <SettingsSection
      label="YNAB"
      footer="Read from YNAB every few minutes while the app is open, and only while this is on. Nothing from YNAB is saved on this device or synced."
    >
      <SettingsRow
        entryId="ynabGroceryBudget"
        icon="wallet-outline"
        iconColor={on ? colors.accent : undefined}
        label="Trip budget from YNAB"
        hint="While shopping, compare the cart to what’s left in a YNAB category this month, instead of a budget you type."
        toggle={on}
        onPress={() => setOn(!on)}
        accessibilityLabel="Trip budget from YNAB"
      />
      {on && (
        <>
          <View style={styles.sep} />
          <YnabAccountRows tokenEntryId="ynabGroceryToken" planEntryId="ynabGroceryPlan" />
        </>
      )}
      {on && (
        <>
          <View style={styles.sep} />
          <SettingsRow
            entryId="ynabGroceryCategory"
            icon="cart-outline"
            iconColor={categoryId && ready ? colors.accent : undefined}
            label="Category"
            hint={!ready
              ? 'Add a token and choose a plan first'
              : chosen
              ? chosen.balanceMinor < 0
                ? `Overspent by ${formatPrice(-chosen.balanceMinor, currencySymbol)} this month`
                : `${formatPrice(chosen.balanceMinor, currencySymbol)} left this month`
              : categoryId ? undefined : 'Which category your groceries come out of'}
            alwaysShowHint={chosen !== null}
            value={ready ? chosen?.name ?? (categoryId ? 'Chosen' : undefined) : undefined}
            expanded={ready && pickerOpen}
            disabled={!ready}
            onPress={() => {
              haptics.tap();
              animateLayout();
              setPickerOpen(!pickerOpen);
            }}
            accessibilityLabel="Choose the YNAB category for groceries"
          />
          {ready && pickerOpen && (
            <SettingsChoiceTray
              caption="Take the budget from"
              options={categories.map(c => ({ id: c.id, title: c.name, group: c.groupName }))}
              selectedId={categoryId}
              subtitleFor={option => option.group}
              onSelect={option => {
                haptics.tap();
                setCategoryId(option.id);
                animateLayout();
                setPickerOpen(false);
              }}
              emptyText={snapshot === null ? 'Loading categories from YNAB…' : 'This plan has no categories to choose from.'}
              accessibilityLabelFor={option => `Take the budget from ${option.title}, in ${option.group}`}
            />
          )}
        </>
      )}
    </SettingsSection>
  );
}
