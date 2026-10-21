import { templateBlocks, type EmailTemplate, type ThumbBlock } from '@/components/email/templates';
import { cn } from '@/lib/utils';

const LINE = 'h-1 rounded-full bg-muted-foreground/40';

function Lines({ count, className }: { count: number; className?: string }) {
  return (
    <span className={cn('flex flex-col gap-1', className)}>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={cn(LINE, i === count - 1 && count > 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </span>
  );
}

function Block({ block }: { block: ThumbBlock }) {
  switch (block.kind) {
    case 'heading':
      return <span className={cn('rounded-sm bg-foreground/75', block.level === 1 ? 'h-2 w-3/4' : 'h-1.5 w-1/2')} />;
    case 'text':
      return <Lines count={block.lines} />;
    case 'list':
      return (
        <span className="flex flex-col gap-1">
          {Array.from({ length: block.items }, (_, i) => (
            <span key={i} className="flex items-center gap-1.5">
              <span className="size-1 shrink-0 rounded-full bg-primary" />
              <span className={cn(LINE, 'w-3/5')} />
            </span>
          ))}
        </span>
      );
    case 'button':
      return <span className="h-3 w-1/3 rounded-sm bg-primary" />;
    case 'quote':
      return <Lines count={block.lines} className="border-l-2 border-primary pl-1.5" />;
  }
}

/**
 * A miniature of a starter letter, drawn from the letter's own structure with
 * theme tokens only: a paper card on the recessed ground, so it reads in light
 * and in dark. Cropped at the bottom the way an inbox preview is.
 */
export function TemplateThumb({ template }: { template: EmailTemplate }) {
  const blocks = templateBlocks(template.bodyHtml);
  return (
    <span aria-hidden data-template-thumb={template.id} className="flex h-28 flex-col overflow-hidden rounded-md bg-surface-sunken px-4 pt-3">
      <span className="flex flex-1 flex-col gap-2 overflow-hidden rounded-t-sm border border-b-0 border-line bg-card px-3 pt-2.5">
        <span className="h-1 w-8 rounded-full bg-primary" />
        {blocks.map((b, i) => <Block key={i} block={b} />)}
      </span>
    </span>
  );
}
