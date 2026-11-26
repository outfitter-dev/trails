import { parse, postprocess, preprocess } from 'micromark';
import { gfmFootnote } from 'micromark-extension-gfm-footnote';
import { gfmTable } from 'micromark-extension-gfm-table';

interface DestinationSpan {
  readonly start: number;
  readonly end: number;
  readonly line: number;
  readonly text: string;
}

type Token = ReturnType<typeof postprocess>[number][1];

export const markdownDestinationSpans = (
  markdown: string
): readonly DestinationSpan[] => {
  const events = postprocess(
    parse({ extensions: [gfmTable(), gfmFootnote()] })
      .document()
      .write(preprocess()(markdown, undefined, true))
  );
  // The preprocessor drops an initial BOM before counting UTF-16 offsets.
  const bom = markdown.startsWith('\uFEFF') ? 1 : 0;
  const labels: (Token | undefined)[] = [];
  const spans: DestinationSpan[] = [];

  for (const [phase, token] of events) {
    switch (token.type) {
      case 'link':
      case 'image':
      case 'definition': {
        if (phase === 'enter') {
          labels.push(undefined);
        } else {
          labels.pop();
        }
        break;
      }
      case 'labelText':
      case 'definitionLabelString': {
        if (phase === 'enter') {
          labels[labels.length - 1] = token;
        }
        break;
      }
      case 'resourceDestinationString':
      case 'definitionDestinationString': {
        if (phase === 'enter') {
          const label = labels.at(-1);
          spans.push({
            end: token.end.offset + bom,
            line: token.start.line,
            start: token.start.offset + bom,
            text: label
              ? markdown
                  .slice(label.start.offset + bom, label.end.offset + bom)
                  .trim()
              : '',
          });
        }
        break;
      }
      default: {
        break;
      }
    }
  }

  return spans;
};
