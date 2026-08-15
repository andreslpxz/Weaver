import { FileText, Image as ImageIcon, File as FileIcon, X, AlertTriangle } from 'lucide-react';
import type { Attachment } from '@/lib/attachments';
import { formatSize } from '@/lib/attachments';
import { cn } from '@/components/common/Button';

interface Props {
  attachments: Attachment[];
  onRemove: (id: string) => void;
  className?: string;
  variant?: 'chips' | 'list';
}

export function AttachmentChips({ attachments, onRemove, className, variant = 'chips' }: Props) {
  if (attachments.length === 0) return null;

  if (variant === 'list') {
    return (
      <div className={cn('space-y-1', className)}>
        {attachments.map((a) => (
          <div
            key={a.id}
            className="flex items-center gap-2 p-2 rounded-codex bg-app-bg border border-border text-xs"
          >
            <AttachmentIcon kind={a.kind} />
            <span className="flex-1 truncate text-text-primary">{a.name}</span>
            <span className="text-text-muted">{formatSize(a.size)}</span>
            {a.truncated && (
              <span className="text-warning inline-flex items-center gap-1" title="Contenido truncado">
                <AlertTriangle size={10} /> trunc
              </span>
            )}
            <button
              onClick={() => onRemove(a.id)}
              className="codex-icon-btn w-5 h-5"
              title="Quitar"
            >
              <X size={10} />
            </button>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={cn('flex flex-wrap gap-1', className)}>
      {attachments.map((a) => (
        <div
          key={a.id}
          className="group flex items-center gap-1.5 pl-1.5 pr-1 py-1 rounded-codex bg-app-bg border border-border-accent text-xs"
          title={`${a.name} · ${formatSize(a.size)}${a.truncated ? ' · truncado' : ''}`}
        >
          {a.thumbnail ? (
            <img
              src={a.thumbnail}
              alt={a.name}
              className="w-6 h-6 rounded object-cover"
            />
          ) : (
            <AttachmentIcon kind={a.kind} className="w-3.5 h-3.5" />
          )}
          <span className="max-w-[160px] truncate text-text-primary">{a.name}</span>
          {a.truncated && <AlertTriangle size={10} className="text-warning" />}
          <button
            onClick={() => onRemove(a.id)}
            className="codex-icon-btn w-5 h-5 opacity-60 group-hover:opacity-100"
            title="Quitar"
          >
            <X size={10} />
          </button>
        </div>
      ))}
    </div>
  );
}

function AttachmentIcon({
  kind,
  className,
}: {
  kind: Attachment['kind'];
  className?: string;
}) {
  const Icon = kind === 'text' ? FileText : kind === 'image' ? ImageIcon : FileIcon;
  const color =
    kind === 'text'
      ? 'text-accent'
      : kind === 'image'
        ? 'text-warning'
        : 'text-text-muted';
  return <Icon size={14} className={cn(color, className)} />;
}
