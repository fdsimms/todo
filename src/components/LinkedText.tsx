import React, { useMemo } from 'react';
import { Linking, Text, type StyleProp, type TextStyle } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { splitLinks } from '../utils/textLinks';

interface Props {
  text: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}

/**
 * Plain text whose web links can be tapped. For notes a person typed or
 * pasted: a tile supplier's page in a project's notes used to be dead text.
 * The links take the accent colour and an underline, so they read as links
 * rather than as the accent-coloured buttons elsewhere.
 */
export function LinkedText({ text, style, numberOfLines }: Props) {
  const colors = useColors();
  const segments = useMemo(() => splitLinks(text), [text]);
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {segments.map((segment, i) =>
        segment.url ? (
          <Text
            key={i}
            style={{ color: colors.accentText, textDecorationLine: 'underline' }}
            onPress={() => { Linking.openURL(segment.url!).catch(() => {}); }}
            accessibilityRole="link"
          >
            {segment.text}
          </Text>
        ) : (
          <React.Fragment key={i}>{segment.text}</React.Fragment>
        ),
      )}
    </Text>
  );
}
