import React from 'react';
import {
  Modal,
  View,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

interface Props {
  visible: boolean;
  onRequestClose: () => void;
  // Kept per-file rather than folded into this component — root/scroll/
  // scrollContent (and the header row's own style) genuinely differ between
  // editors (e.g. scrollContent's bottom padding), so each caller passes its
  // own styles object through.
  rootStyle: StyleProp<ViewStyle>;
  headerStyle: StyleProp<ViewStyle>;
  scrollStyle: StyleProp<ViewStyle>;
  scrollContentStyle: StyleProp<ViewStyle>;
  header: React.ReactNode;
  children: React.ReactNode;
  // Content rendered after the ScrollView but still inside the
  // KeyboardAvoidingView — TaskEditor and ProjectEditor hang picker sheets
  // here, outside the scrollable area.
  footer?: React.ReactNode;
  // Stood down while a row inside is mid-drag (SortableList's
  // onDragStateChange) — a JS responder nested inside a ScrollView doesn't
  // stop it from claiming the touch, so the scroll has to disable itself.
  // Defaults to true; only the editors with a draggable row list pass this.
  scrollEnabled?: boolean;
}

/**
 * The Modal + KeyboardAvoidingView + header row + ScrollView shell every
 * editor sheet (TaskEditor, TaskGroupEditor, ProjectEditor, TemplateEditor,
 * TemplateItemEditor) opens with — see issue #758 for the byte-identical
 * lines this replaces.
 */
export function EditorSheet({
  visible,
  onRequestClose,
  rootStyle,
  headerStyle,
  scrollStyle,
  scrollContentStyle,
  header,
  children,
  footer,
  scrollEnabled = true,
}: Props) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onRequestClose}
    >
      <KeyboardAvoidingView style={rootStyle} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={headerStyle}>{header}</View>

        <ScrollView
          style={scrollStyle}
          scrollEnabled={scrollEnabled}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={scrollContentStyle}
        >
          {children}
        </ScrollView>

        {footer}
      </KeyboardAvoidingView>
    </Modal>
  );
}
