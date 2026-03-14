import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface Props {
  content: string;
}

export default function MarkdownContent({ content }: Props) {
  return (
    <div className="leading-relaxed text-pb-text">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            if (match) {
              return (
                <SyntaxHighlighter
                  style={oneDark}
                  language={match[1]}
                  PreTag="div"
                  customStyle={{
                    margin: 0,
                    borderRadius: '0.25rem',
                    fontSize: '0.75rem',
                  }}
                >
                  {String(children).replace(/\n$/, '')}
                </SyntaxHighlighter>
              );
            }
            return (
              <code
                className="bg-pb-bg px-1 py-0.5 rounded font-mono text-pb-info"
                {...props}
              >
                {children}
              </code>
            );
          },
          pre({ children }) {
            return (
              <pre className="bg-pb-bg border border-pb-border rounded overflow-x-auto my-2">
                {children}
              </pre>
            );
          },
          a({ href, children, ...props }) {
            return (
              <a
                href={href}
                className="text-pb-accent underline"
                target="_blank"
                rel="noopener noreferrer"
                {...props}
              >
                {children}
              </a>
            );
          },
          table({ children }) {
            return (
              <div className="overflow-x-auto my-2 rounded border border-pb-border">
                <table className="border-collapse text-xs w-max min-w-full">
                  {children}
                </table>
              </div>
            );
          },
          th({ children }) {
            return (
              <th className="border border-pb-border px-2 py-1 text-left font-bold text-pb-text bg-pb-surface">
                {children}
              </th>
            );
          },
          td({ children }) {
            return (
              <td className="border border-pb-border px-2 py-1 text-pb-text">
                {children}
              </td>
            );
          },
          blockquote({ children }) {
            return (
              <blockquote className="border-l-2 border-pb-accent pl-3 italic text-pb-text-dim my-2">
                {children}
              </blockquote>
            );
          },
          h1({ children }) {
            return <h1 className="text-pb-text font-bold text-base mt-3 mb-1">{children}</h1>;
          },
          h2({ children }) {
            return <h2 className="text-pb-text font-bold text-sm mt-3 mb-1">{children}</h2>;
          },
          h3({ children }) {
            return <h3 className="text-pb-text font-bold text-xs mt-2 mb-1">{children}</h3>;
          },
          h4({ children }) {
            return <h4 className="text-pb-text font-bold text-xs mt-2 mb-1">{children}</h4>;
          },
          ul({ children }) {
            return <ul className="list-disc pl-4 my-1">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="list-decimal pl-4 my-1">{children}</ol>;
          },
          li({ children }) {
            return <li className="my-0.5">{children}</li>;
          },
          hr() {
            return <hr className="border-pb-border my-3" />;
          },
          img({ src, alt }) {
            return (
              <img
                src={src}
                alt={alt || ''}
                className="max-w-full rounded my-2"
              />
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
