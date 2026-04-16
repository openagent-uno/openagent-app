import { colors, font, radius } from '../theme';
/**
 * Lightweight markdown renderer — editorial prose style matched to the
 * refined Geist typography and paper-soft code blocks.
 * Handles: **bold**, *italic*, `inline code`, ```code blocks```,
 * [links](url), # headers, - bullet lists, > blockquotes.
 */

import type { ReactElement } from 'react';
import { Text, View, StyleSheet, Linking, Platform } from 'react-native';

interface Props {
  text: string;
}

export default function Markdown({ text }: Props) {
  const blocks = parseBlocks(text);
  return (
    <View>
      {blocks.map((block, i) => renderBlock(block, i))}
    </View>
  );
}

type Block =
  | { type: 'paragraph'; text: string }
  | { type: 'code'; lang: string; text: string }
  | { type: 'heading'; level: number; text: string }
  | { type: 'quote'; text: string }
  | { type: 'list'; items: string[] };

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trimStart().startsWith('```')) {
      const lang = line.trimStart().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      blocks.push({ type: 'code', lang, text: codeLines.join('\n') });
      continue;
    }

    const headingMatch = line.match(/^(#{1,4})\s+(.+)/);
    if (headingMatch) {
      blocks.push({ type: 'heading', level: headingMatch[1].length, text: headingMatch[2] });
      i++;
      continue;
    }

    if (line.startsWith('> ')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      blocks.push({ type: 'quote', text: quoteLines.join('\n') });
      continue;
    }

    if (/^[\s]*[-*•]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[\s]*[-*•]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^[\s]*[-*•]\s+/, ''));
        i++;
      }
      blocks.push({ type: 'list', items });
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() && !lines[i].startsWith('```')
      && !lines[i].match(/^#{1,4}\s/) && !lines[i].startsWith('> ')
      && !/^[\s]*[-*•]\s/.test(lines[i])) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length) {
      blocks.push({ type: 'paragraph', text: paraLines.join(' ') });
    }
  }

  return blocks;
}

function renderBlock(block: Block, key: number) {
  switch (block.type) {
    case 'code':
      return (
        <View key={key} style={styles.codeBlock}>
          {block.lang ? (
            <View style={styles.codeHeader}>
              <Text style={styles.codeLang}>{block.lang}</Text>
            </View>
          ) : null}
          <Text style={styles.codeText} selectable>{block.text}</Text>
        </View>
      );
    case 'heading':
      return (
        <Text key={key} style={[
          styles.heading,
          block.level === 1 && styles.h1,
          block.level === 2 && styles.h2,
          block.level >= 3 && styles.h3,
        ]}>
          {renderInline(block.text)}
        </Text>
      );
    case 'quote':
      return (
        <View key={key} style={styles.blockquote}>
          <Text style={styles.quoteText}>{renderInline(block.text)}</Text>
        </View>
      );
    case 'list':
      return (
        <View key={key} style={styles.list}>
          {block.items.map((item, j) => (
            <View key={j} style={styles.listItem}>
              <Text style={styles.bullet}>—</Text>
              <Text style={styles.listText}>{renderInline(item)}</Text>
            </View>
          ))}
        </View>
      );
    case 'paragraph':
      return (
        <Text key={key} style={styles.paragraph}>
          {renderInline(block.text)}
        </Text>
      );
  }
}

function renderInline(text: string): (string | ReactElement)[] {
  const parts: (string | ReactElement)[] = [];
  const re = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index));
    }

    if (match[2]) {
      parts.push(<Text key={`b${idx++}`} style={styles.bold}>{match[2]}</Text>);
    } else if (match[4]) {
      parts.push(<Text key={`i${idx++}`} style={styles.italic}>{match[4]}</Text>);
    } else if (match[6]) {
      parts.push(<Text key={`c${idx++}`} style={styles.inlineCode}>{match[6]}</Text>);
    } else if (match[8] && match[9]) {
      parts.push(
        <Text
          key={`l${idx++}`}
          style={styles.link}
          onPress={() => Linking.openURL(match![9])}
        >
          {match[8]}
        </Text>
      );
    }

    last = match.index + match[0].length;
  }

  if (last < text.length) {
    parts.push(text.slice(last));
  }

  return parts.length ? parts : [text];
}

const styles = StyleSheet.create({
  paragraph: {
    fontSize: 14, lineHeight: 23, color: colors.text,
    marginBottom: 10, fontFamily: font.sans,
  },
  heading: {
    fontWeight: '600', color: colors.text,
    marginBottom: 8, marginTop: 8,
    fontFamily: font.display,
    letterSpacing: -0.3,
  },
  h1: { fontSize: 22, fontWeight: '600' },
  h2: { fontSize: 18, fontWeight: '600' },
  h3: { fontSize: 15, fontWeight: '600' },
  bold: { fontWeight: '600' },
  italic: { fontStyle: 'italic' },
  inlineCode: {
    fontFamily: font.mono,
    fontSize: 12.5,
    backgroundColor: colors.codeBg,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radius.xs,
    color: colors.primary,
  },
  link: {
    color: colors.primary,
    textDecorationLine: 'underline',
    // @ts-ignore
    textDecorationStyle: 'dotted',
  },
  codeBlock: {
    backgroundColor: colors.codeBg,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.codeBorder,
    marginVertical: 8,
    overflow: 'hidden',
  },
  codeHeader: {
    paddingHorizontal: 12, paddingVertical: 5,
    borderBottomWidth: 1, borderBottomColor: colors.codeBorder,
    backgroundColor: Platform.OS === 'web' ? 'transparent' : colors.codeBg,
  },
  codeLang: {
    fontSize: 10, color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.8,
    fontFamily: font.mono, fontWeight: '500',
  },
  codeText: {
    fontFamily: font.mono,
    fontSize: 12.5,
    lineHeight: 19,
    color: colors.codeText,
    padding: 12,
  },
  blockquote: {
    borderLeftWidth: 2,
    borderLeftColor: colors.primary,
    paddingLeft: 14,
    marginVertical: 8,
    opacity: 0.9,
  },
  quoteText: {
    fontSize: 14, lineHeight: 22, color: colors.textSecondary,
    fontStyle: 'italic',
    fontFamily: font.serif,
  },
  list: { marginVertical: 6 },
  listItem: {
    flexDirection: 'row', marginBottom: 4, paddingLeft: 2,
  },
  bullet: {
    color: colors.primary, marginRight: 10, fontSize: 14,
    fontWeight: '600',
  },
  listText: {
    flex: 1, fontSize: 14, lineHeight: 22, color: colors.text,
    fontFamily: font.sans,
  },
});
