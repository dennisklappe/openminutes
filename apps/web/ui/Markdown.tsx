import type { Block, Inline } from './markdown.js';
import { parseMarkdown, tableColumnClasses } from './markdown.js';

function InlineText({ parts }: { parts: Inline[] }) {
  return parts.map((part, index) => {
    switch (part.type) {
      case 'strong':
        return <strong key={index}>{part.text}</strong>;
      case 'em':
        return <em key={index}>{part.text}</em>;
      case 'code':
        return <code key={index}>{part.text}</code>;
      case 'link':
        return (
          <a key={index} href={part.href} target="_blank" rel="noreferrer noopener">
            {part.text}
          </a>
        );
      case 'text':
        return part.text;
    }
  });
}

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case 'heading': {
      const Tag = block.level <= 2 ? 'h3' : 'h4';
      return (
        <Tag>
          <InlineText parts={block.inline} />
        </Tag>
      );
    }
    case 'paragraph':
      return (
        <p>
          <InlineText parts={block.inline} />
        </p>
      );
    case 'table': {
      const classes = tableColumnClasses(block.header, block.rows);
      return (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                {block.header.map((cell, column) => (
                  <th key={column} className={classes[column] || undefined}>
                    <InlineText parts={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, index) => (
                <tr key={index}>
                  {row.map((cell, column) => (
                    <td key={column} className={classes[column] || undefined}>
                      <InlineText parts={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag>
          {block.items.map((item, index) => (
            <li key={index}>
              <InlineText parts={item} />
            </li>
          ))}
        </Tag>
      );
    }
  }
}

export function Markdown({ source }: { source: string }) {
  return (
    <div className="markdown">
      {parseMarkdown(source).map((block, index) => (
        <BlockView key={index} block={block} />
      ))}
    </div>
  );
}
