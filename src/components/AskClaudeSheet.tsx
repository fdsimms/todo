import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SheetModal } from './SheetModal';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { TextField } from './TextField';
import { PressableScale } from './PressableScale';
import { InlineAction } from './InlineAction';
import { HelpText } from './HelpText';
import { BUTTON_LABEL } from '../copy/shared';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, interaction, lineHeight, radius, spacing, type Colors } from '../theme';
import { useKeyboardHeight } from '../hooks/useKeyboardHeight';
import { useSyncStore } from '../store/useSyncStore';
import { askClaude, confirmPreview, describeAskError, undoConfirmed } from '../services/askClaudeCalls';
import {
  doneLine,
  previewNote,
  readAskReply,
  userTurn,
  type AskPreview,
  type AskTurn,
  type PreviewOutcome,
} from '../utils/askClaudeChat';
import { haptics } from '../utils/haptics';

/**
 * Ask Claude: a chat that changes the person's data for them
 * (`src/utils/askClaudeChat.ts` has the design). Claude's words come back as
 * bubbles, and each change it proposes as a card listing what it will do,
 * with Confirm and Cancel. Nothing changes until Confirm, which the phone
 * sends to the server itself; a confirmed card offers Undo.
 *
 * The conversation is this sheet's own state and lasts while it is mounted
 * (its host keeps it, `LazySheet`), so closing and reopening carries on where
 * it was. New chat starts over.
 */

type CardStatus = 'pending' | 'confirming' | 'applied' | 'undoing' | 'undone' | 'cancelled' | 'failed';

type Entry =
  | { id: string; kind: 'me'; text: string }
  | { id: string; kind: 'claude'; text: string }
  | { id: string; kind: 'error'; text: string }
  | { id: string; kind: 'preview'; preview: AskPreview; status: CardStatus; batchId: string | null; message: string | null };

const SUGGESTIONS = [
  'What’s left for today?',
  'Add oat milk to the grocery list',
  'Move everything left today to tomorrow',
];

let nextEntryId = 0;
const entryId = () => `ask-${++nextEntryId}`;

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function AskClaudeSheet({ visible, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const keyboardHeight = useKeyboardHeight(visible);
  const scrollRef = useRef<ScrollView>(null);

  const [history, setHistory] = useState<AskTurn[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  /** What the person did with previews since their last message, sent ahead of the next one. */
  const notes = useRef<string[]>([]);
  /**
   * Bumped by New chat, so a reply or a confirm that lands after it is
   * dropped rather than written into the new conversation.
   */
  const conversation = useRef(0);

  const updateCard = useCallback((id: string, patch: Partial<Extract<Entry, { kind: 'preview' }>>) => {
    setEntries(prev => prev.map(e => (e.id === id && e.kind === 'preview' ? { ...e, ...patch } : e)));
  }, []);

  const send = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!text || busy) return;
    const started = conversation.current;
    const sentNotes = notes.current;
    notes.current = [];
    const turn = userTurn(text, sentNotes);
    const asked = [...history, turn];
    setDraft('');
    setBusy(true);
    setHistory(asked);
    setEntries(prev => [...prev, { id: entryId(), kind: 'me', text }]);
    try {
      const reply = await askClaude(asked);
      if (conversation.current !== started) return;
      setHistory(prev => [...prev, reply]);
      const items = readAskReply(Array.isArray(reply.content) ? reply.content : []);
      setEntries(prev => [
        ...prev,
        ...items.map((item): Entry => (item.kind === 'text'
          ? { id: entryId(), kind: 'claude', text: item.text }
          : { id: entryId(), kind: 'preview', preview: item.preview, status: 'pending', batchId: null, message: null })),
      ]);
    } catch (e) {
      if (conversation.current !== started) return;
      // The message never got an answer, so it leaves the conversation the API
      // sees (which must alternate) and its notes wait for the next one.
      setHistory(prev => prev.filter(t => t !== turn));
      notes.current = [...sentNotes, ...notes.current];
      setEntries(prev => [...prev, { id: entryId(), kind: 'error', text: describeAskError(e) }]);
    } finally {
      if (conversation.current === started) setBusy(false);
    }
  }, [busy, history]);

  const note = (preview: AskPreview, outcome: PreviewOutcome) => {
    notes.current = [...notes.current, previewNote(preview, outcome)];
  };

  const confirm = useCallback(async (entry: Extract<Entry, { kind: 'preview' }>) => {
    if (entry.status !== 'pending') return;
    const started = conversation.current;
    haptics.tap();
    updateCard(entry.id, { status: 'confirming' });
    const outcome = await confirmPreview(entry.preview);
    if (conversation.current !== started) return;
    if (outcome.ok) {
      haptics.success();
      note(entry.preview, 'confirmed');
      updateCard(entry.id, { status: 'applied', batchId: outcome.batchId });
      // The change was made on the server; pull it so it shows here now.
      void useSyncStore.getState().syncNow().catch(() => null);
    } else {
      haptics.error();
      note(entry.preview, 'failed');
      updateCard(entry.id, { status: 'failed', message: outcome.reason });
    }
  }, [updateCard]);

  const cancel = useCallback((entry: Extract<Entry, { kind: 'preview' }>) => {
    if (entry.status !== 'pending') return;
    haptics.tap();
    note(entry.preview, 'cancelled');
    updateCard(entry.id, { status: 'cancelled' });
  }, [updateCard]);

  const undo = useCallback(async (entry: Extract<Entry, { kind: 'preview' }>) => {
    if (entry.status !== 'applied' || !entry.batchId) return;
    const started = conversation.current;
    haptics.tap();
    updateCard(entry.id, { status: 'undoing', message: null });
    const outcome = await undoConfirmed(entry.batchId);
    if (conversation.current !== started) return;
    if (outcome.ok) {
      haptics.success();
      note(entry.preview, 'undone');
      const skipped = outcome.skipped > 0
        ? `${outcome.skipped} ${outcome.skipped === 1 ? 'change was' : 'changes were'} left as ${outcome.skipped === 1 ? 'it is' : 'they are'} because ${outcome.skipped === 1 ? 'it' : 'they'} changed since.`
        : null;
      updateCard(entry.id, { status: 'undone', message: skipped });
    } else {
      haptics.error();
      updateCard(entry.id, { status: 'applied', message: outcome.reason });
    }
  }, [updateCard]);

  const newChat = useCallback(() => {
    haptics.tap();
    conversation.current += 1;
    notes.current = [];
    setHistory([]);
    setEntries([]);
    setBusy(false);
  }, []);

  const canSend = draft.trim().length > 0 && !busy;

  return (
    <SheetModal name="AskClaudeSheet" visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <SheetHeader
          title="Ask Claude"
          icon="sparkles"
          left={(
            <SheetHeaderButton
              label="New chat"
              role="cancel"
              onPress={newChat}
              disabled={entries.length === 0}
              minWidth={84}
            />
          )}
          right={<SheetHeaderButton label={BUTTON_LABEL.done} onPress={onClose} minWidth={84} />}
        />

        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.convo}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          {entries.length === 0 ? (
            <View style={styles.intro}>
              <View style={styles.introIcon}>
                <Ionicons name="sparkles" size={iconSize.xl} color={colors.purple} />
              </View>
              <Text style={styles.introTitle}>Ask Claude to change things for you</Text>
              <Text style={styles.introText}>
                Tasks, groceries, the meal plan and more. You see each change before it happens, and nothing changes until you tap Confirm.
              </Text>
              <View style={styles.suggestions}>
                {SUGGESTIONS.map(s => (
                  <TouchableOpacity
                    key={s}
                    style={styles.suggestion}
                    activeOpacity={interaction.activeOpacity}
                    onPress={() => { haptics.tap(); void send(s); }}
                    accessibilityRole="button"
                  >
                    <Text style={styles.suggestionText}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ) : entries.map(entry => {
            switch (entry.kind) {
              case 'me':
                return <View key={entry.id} style={styles.me}><Text style={styles.meText} selectable>{entry.text}</Text></View>;
              case 'claude':
                return <View key={entry.id} style={styles.claude}><Text style={styles.claudeText} selectable>{entry.text}</Text></View>;
              case 'error':
                return (
                  <View key={entry.id} style={styles.claude}>
                    <Text style={styles.errorText}>{entry.text}</Text>
                  </View>
                );
              case 'preview':
                return (
                  <PreviewCard
                    key={entry.id}
                    entry={entry}
                    styles={styles}
                    colors={colors}
                    onConfirm={() => { void confirm(entry); }}
                    onCancel={() => cancel(entry)}
                    onUndo={() => { void undo(entry); }}
                  />
                );
            }
          })}
          {busy && (
            <View style={[styles.claude, styles.working]} accessibilityLabel="Claude is replying">
              <ActivityIndicator size="small" color={colors.purple} />
            </View>
          )}
        </ScrollView>

        <View style={[styles.composer, { paddingBottom: keyboardHeight > 0 ? keyboardHeight + spacing.sm : spacing.lg }]}>
          <View style={styles.field}>
            <TextField
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              placeholder="e.g. Add oat milk to the grocery list"
              placeholderTextColor={colors.textTertiary}
              returnKeyType="send"
              onSubmitEditing={() => { void send(draft); }}
              blurOnSubmit={false}
              accessibilityLabel="Message Claude"
            />
            <PressableScale
              style={[styles.send, !canSend && styles.sendOff]}
              onPress={() => { void send(draft); }}
              disabled={!canSend}
              accessibilityLabel="Send"
            >
              <Ionicons name="arrow-up" size={iconSize.sm} color={canSend ? colors.onAccent : colors.bgSecondary} />
            </PressableScale>
          </View>
          <HelpText style={styles.foot}>Uses your Anthropic key</HelpText>
        </View>
      </View>
    </SheetModal>
  );
}

function PreviewCard({ entry, styles, colors, onConfirm, onCancel, onUndo }: {
  entry: Extract<Entry, { kind: 'preview' }>;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
  onConfirm: () => void;
  onCancel: () => void;
  onUndo: () => void;
}) {
  const { preview, status, message, batchId } = entry;
  const canConfirm = preview.confirmToken !== null;
  const settled = status === 'cancelled' || status === 'failed' || status === 'undone';
  return (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>{canConfirm ? 'Claude will' : 'Claude checked'}</Text>
      {preview.willDo.map((line, i) => (
        <View key={i} style={[styles.line, i > 0 && styles.lineSep]}>
          <Ionicons name="create-outline" size={iconSize.md} color={settled ? colors.textTertiary : colors.accent} />
          <Text style={[styles.lineText, settled && styles.lineSettled]}>{line}</Text>
        </View>
      ))}

      {!canConfirm ? null : status === 'pending' || status === 'confirming' ? (
        <View style={styles.buttons}>
          <PressableScale style={[styles.button, styles.buttonNeutral]} onPress={onCancel} disabled={status === 'confirming'}>
            <Text style={styles.buttonNeutralText}>{BUTTON_LABEL.cancel}</Text>
          </PressableScale>
          <PressableScale style={[styles.button, styles.buttonPrimary]} onPress={onConfirm} disabled={status === 'confirming'} accessibilityLabel="Confirm this change">
            {status === 'confirming'
              ? <ActivityIndicator size="small" color={colors.onAccent} />
              : <Text style={styles.buttonPrimaryText}>Confirm</Text>}
          </PressableScale>
        </View>
      ) : (
        <View style={styles.result}>
          {status === 'applied' || status === 'undoing' ? (
            <>
              <Ionicons name="checkmark-circle" size={iconSize.md} color={colors.green} />
              <Text style={styles.resultText}>{doneLine(preview)}</Text>
              {batchId && (
                status === 'undoing'
                  ? <ActivityIndicator size="small" color={colors.accent} style={styles.resultAction} />
                  : <View style={styles.resultAction}><InlineAction label="Undo" onPress={onUndo} /></View>
              )}
            </>
          ) : status === 'undone' ? (
            <>
              <Ionicons name="arrow-undo" size={iconSize.md} color={colors.textTertiary} />
              <Text style={styles.resultText}>Undone. It’s back how it was.</Text>
            </>
          ) : status === 'cancelled' ? (
            <>
              <Ionicons name="close-circle" size={iconSize.md} color={colors.textTertiary} />
              <Text style={styles.resultText}>Cancelled. Nothing changed.</Text>
            </>
          ) : (
            <>
              <Ionicons name="alert-circle" size={iconSize.md} color={colors.red} />
              <Text style={styles.resultText}>Not made.</Text>
            </>
          )}
        </View>
      )}
      {!!message && <Text style={[styles.message, status === 'failed' && styles.messageError]}>{message}</Text>}
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    scroll: { flex: 1 },
    convo: { flexGrow: 1, padding: spacing.md, gap: spacing.sm },

    intro: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.sm, paddingBottom: spacing.lg },
    introIcon: {
      width: 56, height: 56, borderRadius: 28, backgroundColor: colors.bgTertiary,
      alignItems: 'center', justifyContent: 'center', marginBottom: spacing.smd,
    },
    introTitle: { fontSize: font.lg, fontWeight: fontWeight.semibold, color: colors.text, textAlign: 'center', marginBottom: spacing.xsm },
    introText: { fontSize: font.sm, lineHeight: lineHeight.sm, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.md },
    suggestions: { alignSelf: 'stretch', gap: spacing.sm },
    suggestion: { backgroundColor: colors.bgSecondary, borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: spacing.smd },
    suggestionText: { fontSize: font.md, color: colors.text },

    // Your messages on the right in the accent, Claude's on the left on a card,
    // each with its tail corner squared off at the side it comes from.
    me: {
      alignSelf: 'flex-end', maxWidth: '80%', backgroundColor: colors.accentFill,
      paddingVertical: spacing.sm, paddingHorizontal: spacing.smd,
      borderRadius: radius.lg, borderBottomRightRadius: spacing.xs,
    },
    meText: { fontSize: font.md, lineHeight: lineHeight.md, color: colors.onAccent },
    claude: {
      alignSelf: 'flex-start', maxWidth: '80%', backgroundColor: colors.bgSecondary,
      paddingVertical: spacing.sm, paddingHorizontal: spacing.smd,
      borderRadius: radius.lg, borderBottomLeftRadius: spacing.xs,
    },
    claudeText: { fontSize: font.md, lineHeight: lineHeight.md, color: colors.text },
    errorText: { fontSize: font.md, lineHeight: lineHeight.md, color: colors.redText },
    working: { paddingVertical: spacing.smd, paddingHorizontal: spacing.md },

    card: {
      alignSelf: 'flex-start', width: '88%', backgroundColor: colors.bgSecondary,
      padding: spacing.smd, borderRadius: radius.lg, borderBottomLeftRadius: spacing.xs,
    },
    cardLabel: {
      fontSize: font.xs, fontWeight: fontWeight.semibold, letterSpacing: 0.8, textTransform: 'uppercase',
      color: colors.textSecondary, marginBottom: spacing.xs,
    },
    line: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.sm },
    lineSep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
    lineText: { flex: 1, fontSize: font.md, lineHeight: lineHeight.md, color: colors.text },
    lineSettled: { color: colors.textSecondary },
    buttons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
    button: { flex: 1, minHeight: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.smd },
    buttonNeutral: { backgroundColor: colors.bgTertiary },
    buttonNeutralText: { fontSize: font.md, fontWeight: fontWeight.semibold, color: colors.text },
    buttonPrimary: { backgroundColor: colors.accentFill },
    buttonPrimaryText: { fontSize: font.md, fontWeight: fontWeight.semibold, color: colors.onAccent },
    result: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs, minHeight: 32 },
    resultText: { flexShrink: 1, fontSize: font.md, color: colors.textSecondary },
    resultAction: { marginLeft: 'auto' },
    message: { fontSize: font.sm, lineHeight: lineHeight.sm, color: colors.textSecondary, marginTop: spacing.xs },
    messageError: { color: colors.redText },

    composer: {
      paddingTop: spacing.sm, paddingHorizontal: spacing.smd,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator, backgroundColor: colors.bg,
    },
    field: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.bgSecondary,
      borderRadius: 20, paddingVertical: spacing.xsm, paddingLeft: 14, paddingRight: spacing.xsm, minHeight: 40,
    },
    input: { flex: 1, fontSize: font.md, color: colors.text, paddingVertical: spacing.xs },
    send: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.accentFill, alignItems: 'center', justifyContent: 'center' },
    sendOff: { backgroundColor: colors.bgQuaternary },
    foot: { fontSize: font.xxs, color: colors.textTertiary, textAlign: 'center', marginTop: spacing.xsm },
  });
}
